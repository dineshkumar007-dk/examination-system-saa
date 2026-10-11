import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { query, transaction } from "../config/database.js";
import { digest, token, nowMs, dateSql, fail } from "../utils/security.js";
import { audit } from "./administration.js";
import { enqueue } from "./communications.js";
export function gateExam(row, workstation, now = Date.now()) {
  return (
    !!row &&
    !!workstation &&
    row.registration_status === "completed" &&
    row.user_status === "active" &&
    !!row.email_verified_at &&
    row.exam_status === "active" &&
    !!row.center_active &&
    !!row.computer_active &&
    !!row.verified_at &&
    ["Verified", "Exam Started"].includes(row.attendance) &&
    row.computer_id === workstation.computer_id &&
    row.slot_id === workstation.slot_id &&
    now >= nowMs(row.starts_at) &&
    now < nowMs(row.ends_at) &&
    now < nowMs(workstation.expires_at)
  );
}
const allocationSql = `SELECT a.*,r.user_id,r.exam_id,r.registration_number,r.status AS registration_status,u.status AS user_status,u.email_verified_at,u.phone_verified_at,u.name AS candidate_name,e.name AS exam_name,e.status AS exam_status,e.duration_minutes,e.instructions,s.starts_at,s.ends_at,s.center_id,c.active AS center_active,pc.active AS computer_active,h.hall_number,h.exam_password_hash FROM candidate_allocations a JOIN registrations r ON r.id=a.registration_id JOIN users u ON u.id=r.user_id JOIN examinations e ON e.id=r.exam_id JOIN exam_slots s ON s.id=a.slot_id JOIN exam_centers c ON c.id=s.center_id LEFT JOIN computers pc ON pc.id=a.computer_id JOIN hall_tickets h ON h.allocation_id=a.id`;
export async function finalize(attempt, c) {
  if (attempt.status === "submitted") return;
  await query(
    "UPDATE exam_attempts SET status='submitted',submitted_at=LEAST(UTC_TIMESTAMP(3),deadline) WHERE id=? AND status='in_progress'",
    [attempt.id],
    c,
  );
  await query(
    "UPDATE candidate_allocations SET attendance='Exam Submitted' WHERE id=?",
    [attempt.allocation_id],
    c,
  );
  await query(
    "INSERT IGNORE INTO results(attempt_id,status) VALUES(?,'Not Evaluated')",
    [attempt.id],
    c,
  );
}
export async function finalizeExpired(limit = 100) {
  const rows = await query(
    "SELECT id FROM exam_attempts WHERE status='in_progress' AND deadline<=UTC_TIMESTAMP(3) ORDER BY deadline LIMIT ?",
    [limit],
  );
  for (const row of rows)
    await transaction(async (c) => {
      const [a] = await query(
        "SELECT * FROM exam_attempts WHERE id=? FOR UPDATE",
        [row.id],
        c,
      );
      if (a?.status === "in_progress" && nowMs(a.deadline) <= Date.now())
        await finalize(a, c);
    });
  return rows.length;
}
export async function examLogin(
  userId,
  registrationNumber,
  hallNumber,
  password,
  workstationToken,
) {
  const [info] = await query(
    allocationSql +
      " WHERE r.registration_number=? AND h.hall_number=? AND r.user_id=?",
    [registrationNumber, hallNumber, userId],
  );
  if (!info) fail(401, "Invalid examination credentials.");
  if (!info.exam_password_hash)
    fail(
      409,
      "Your examination password is not set. Open the hall-ticket setup email and set your separate examination password. If the email has not arrived, contact the administrator to send the queued setup email.",
    );
  if (!(await bcrypt.compare(password, info.exam_password_hash)))
    fail(401, "Invalid examination credentials.");
  const access = token();
  const result = await transaction(async (c) => {
    const [row] = await query(
      allocationSql + " WHERE a.id=? FOR UPDATE",
      [info.id],
      c,
    );
    if (row.exam_password_hash !== info.exam_password_hash)
      fail(401, "Examination credentials changed. Please sign in again.");
    const [workstation] = await query(
      "SELECT * FROM workstation_sessions WHERE token_hash=?",
      [digest(workstationToken || "")],
      c,
    );
    const [old] = await query(
      "SELECT * FROM exam_attempts WHERE allocation_id=? FOR UPDATE",
      [row.id],
      c,
    );
    if (
      old &&
      (old.status === "submitted" || nowMs(old.deadline) <= Date.now())
    ) {
      await finalize(old, c);
      return {
        error: "This examination has already been submitted or has expired.",
      };
    }
    if (!gateExam(row, workstation))
      return {
        error:
          "Examination access denied. Check center, workstation, slot, attendance, verification and examination status with your invigilator.",
      };
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM questions WHERE exam_id=?",
      [row.exam_id],
      c,
    );
    if (!n) fail(409, "The examination has no questions.");
    const id = old?.id || randomUUID();
    if (old)
      await query(
        "UPDATE exam_attempts SET access_hash=? WHERE id=?",
        [digest(access), id],
        c,
      );
    else
      await query(
        "INSERT INTO exam_attempts(id,allocation_id,access_hash,started_at,deadline) VALUES(?,?,?,UTC_TIMESTAMP(3),?)",
        [
          id,
          row.id,
          digest(access),
          dateSql(
            Math.min(
              Date.now() + row.duration_minutes * 60000,
              nowMs(row.ends_at),
            ),
          ),
        ],
        c,
      );
    await query(
      "UPDATE candidate_allocations SET attendance='Exam Started' WHERE id=?",
      [row.id],
      c,
    );
    return { id };
  });
  if (result.error) fail(403, result.error);
  return { access, id: result.id };
}
async function withAttempt(userId, accessToken, workstationToken, fn) {
  const result = await transaction(async (c) => {
    const [attempt] = await query(
      "SELECT t.* FROM exam_attempts t JOIN candidate_allocations a ON a.id=t.allocation_id JOIN registrations r ON r.id=a.registration_id WHERE t.access_hash=? AND r.user_id=? FOR UPDATE",
      [digest(accessToken || ""), userId],
      c,
    );
    if (!attempt)
      return { error: "No valid examination session.", status: 401 };
    if (attempt.status === "submitted")
      return { submitted: true, submittedAt: attempt.submitted_at };
    if (nowMs(attempt.deadline) <= Date.now()) {
      await finalize(attempt, c);
      return { submitted: true, expired: true };
    }
    const [row] = await query(
      allocationSql + " WHERE a.id=?",
      [attempt.allocation_id],
      c,
    );
    const [workstation] = await query(
      "SELECT * FROM workstation_sessions WHERE token_hash=?",
      [digest(workstationToken || "")],
      c,
    );
    if (!gateExam(row, workstation))
      return {
        error: "Your examination authorization is no longer valid.",
        status: 403,
      };
    return fn(attempt, row, c);
  });
  if (result.error) fail(result.status, result.error);
  return result;
}
export async function getAttempt(userId, access, workstation) {
  return withAttempt(userId, access, workstation, async (attempt, row, c) => {
    const questions = await query(
      "SELECT id,type,prompt,marks,negative_marks,position FROM questions WHERE exam_id=? ORDER BY position",
      [row.exam_id],
      c,
    );
    const options = await query(
      "SELECT o.question_id,o.option_id AS id,o.option_text AS text FROM question_options o JOIN questions q ON q.id=o.question_id WHERE q.exam_id=? ORDER BY o.option_id",
      [row.exam_id],
      c,
    );
    const answers = await query(
      "SELECT question_id,answer,visited,review,revision FROM student_answers WHERE attempt_id=?",
      [attempt.id],
      c,
    );
    return {
      id: attempt.id,
      candidateName: row.candidate_name,
      examName: row.exam_name,
      instructions: row.instructions,
      deadline: nowMs(attempt.deadline),
      serverTime: Date.now(),
      questions: questions.map((q) => ({
        ...q,
        options: options.filter((o) => o.question_id === q.id),
      })),
      answers,
    };
  });
}
export function validateAnswer(question, options, answer) {
  if (answer === null) return;
  if (question.type === "NAT") {
    if (
      typeof answer !== "number" ||
      !Number.isFinite(answer) ||
      Math.abs(answer) > 1e12
    )
      fail(400, "Enter a valid numeric response.");
  } else if (
    !Array.isArray(answer) ||
    !answer.length ||
    answer.some((v) => !options.includes(v)) ||
    new Set(answer).size !== answer.length ||
    (question.type === "MCQ" && answer.length !== 1)
  )
    fail(400, "Select valid options for this question.");
}
export async function saveAnswer(userId, access, workstation, data) {
  return withAttempt(userId, access, workstation, async (attempt, row, c) => {
    const [question] = await query(
      "SELECT id,type FROM questions WHERE id=? AND exam_id=?",
      [data.questionId, row.exam_id],
      c,
    );
    if (!question) fail(404, "Question not found in this examination.");
    const options = await query(
      "SELECT option_id FROM question_options WHERE question_id=?",
      [question.id],
      c,
    );
    validateAnswer(
      question,
      options.map((o) => o.option_id),
      data.answer,
    );
    const [old] = await query(
      "SELECT * FROM student_answers WHERE attempt_id=? AND question_id=?",
      [attempt.id, question.id],
      c,
    );
    const same =
      old &&
      JSON.stringify(old.answer) === JSON.stringify(data.answer) &&
      !!old.review === data.review;
    if (same) return { revision: old.revision };
    if ((old?.revision || 0) !== data.expectedRevision)
      fail(409, "A newer answer exists. Reload before editing this question.");
    const revision = (old?.revision || 0) + 1;
    await query(
      "INSERT INTO student_answers(attempt_id,question_id,answer,review,revision) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE answer=VALUES(answer),review=VALUES(review),revision=VALUES(revision),updated_at=UTC_TIMESTAMP(3)",
      [
        attempt.id,
        question.id,
        JSON.stringify(data.answer),
        data.review,
        revision,
      ],
      c,
    );
    return { revision };
  });
}
export async function submitAttempt(userId, access, workstation) {
  return withAttempt(userId, access, workstation, async (attempt, row, c) => {
    await finalize(attempt, c);
    return { submitted: true, submittedAt: Date.now() };
  });
}
export function grade(question, answer) {
  if (
    answer === null ||
    answer === undefined ||
    (Array.isArray(answer) && !answer.length)
  )
    return 0;
  const key = question.correct_answer;
  const correct =
    question.type === "NAT"
      ? typeof answer === "number" &&
        Math.abs(answer - key) <= Number(question.tolerance)
      : Array.isArray(answer) &&
        [...answer].sort().join(",") === [...key].sort().join(",");
  return correct ? Number(question.marks) : -Number(question.negative_marks);
}
export async function evaluate(actor, examId) {
  await transaction(async (c) => {
    const [exam] = await query(
      "SELECT * FROM examinations WHERE id=? FOR UPDATE",
      [examId],
      c,
    );
    if (!exam) fail(404, "Examination not found.");
    const rows = await query(
      "SELECT t.* FROM exam_attempts t JOIN candidate_allocations a ON a.id=t.allocation_id JOIN registrations r ON r.id=a.registration_id WHERE r.exam_id=? AND t.status='submitted' FOR UPDATE",
      [examId],
      c,
    );
    const questions = await query(
      "SELECT q.*,k.correct_answer,k.tolerance FROM questions q JOIN answer_keys k ON k.question_id=q.id WHERE q.exam_id=?",
      [examId],
      c,
    );
    for (const attempt of rows) {
      const answers = await query(
        "SELECT question_id,answer FROM student_answers WHERE attempt_id=?",
        [attempt.id],
        c,
      );
      const score = questions.reduce(
        (sum, q) =>
          sum + grade(q, answers.find((a) => a.question_id === q.id)?.answer),
        0,
      );
      const [existing] = await query(
        "SELECT status FROM results WHERE attempt_id=?",
        [attempt.id],
        c,
      );
      if (existing?.status === "Published")
        fail(409, "Published results are locked.");
      await query(
        "INSERT INTO results(attempt_id,score,status,evaluated_at) VALUES(?,?,'Evaluated',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE score=VALUES(score),status='Evaluated',evaluated_at=UTC_TIMESTAMP(3)",
        [attempt.id, score],
        c,
      );
    }
    await audit(actor, "results.evaluate", examId, c);
  });
}
export async function publish(actor, examId) {
  await transaction(async (c) => {
    const [exam] = await query(
      "SELECT * FROM examinations WHERE id=? FOR UPDATE",
      [examId],
      c,
    );
    if (exam?.status !== "completed")
      fail(409, "Complete the examination before publishing.");
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM exam_attempts t JOIN candidate_allocations a ON a.id=t.allocation_id JOIN registrations r ON r.id=a.registration_id LEFT JOIN results rs ON rs.attempt_id=t.id WHERE r.exam_id=? AND (t.status<>'submitted' OR rs.status='Not Evaluated' OR rs.status IS NULL)",
      [examId],
      c,
    );
    if (n)
      fail(
        409,
        "All attempts must be submitted and evaluated before publication.",
      );
    const rows = await query(
      "SELECT rs.attempt_id,r.user_id FROM results rs JOIN exam_attempts t ON t.id=rs.attempt_id JOIN candidate_allocations a ON a.id=t.allocation_id JOIN registrations r ON r.id=a.registration_id WHERE r.exam_id=? AND rs.status='Evaluated'",
      [examId],
      c,
    );
    for (const row of rows) {
      await query(
        "UPDATE results SET status='Published',published_at=UTC_TIMESTAMP(3) WHERE attempt_id=?",
        [row.attempt_id],
        c,
      );
      await enqueue(
        row.user_id,
        "Results published",
        `Results for ${exam.name} are now available in your dashboard.`,
        c,
      );
    }
    await audit(actor, "results.publish", examId, c);
  });
}
