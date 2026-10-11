import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { query, transaction } from "../config/database.js";
import { appUrl } from "../config/env.js";
import { token, digest, dateSql, nowMs, fail } from "../utils/security.js";
import { centerScope } from "../middleware/security.js";
import { enqueue } from "./communications.js";
export async function audit(actor, action, entity, connection) {
  await query(
    "INSERT INTO audit_logs(actor_id,action,entity_id) VALUES(?,?,?)",
    [actor, action, entity],
    connection,
  );
}
export async function deleteUser(actor, userId) {
  if (actor === userId) fail(409, "You cannot delete your own account.");
  return transaction(async (c) => {
    const [user] = await query(
      "SELECT id,role,deleted_at FROM users WHERE id=? FOR UPDATE",
      [userId],
      c,
    );
    if (!user) fail(404, "User not found.");
    if (user.role === "admin")
      fail(409, "Administrator accounts cannot be deleted here.");
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM registrations WHERE user_id=?",
      [userId],
      c,
    );
    await query("DELETE FROM sessions WHERE user_id=?", [userId], c);
    await query(
      "DELETE FROM workstation_sessions WHERE issued_by=?",
      [userId],
      c,
    );
    await query(
      "DELETE FROM contact_verifications WHERE user_id=?",
      [userId],
      c,
    );
    await query(
      "DELETE k FROM activation_tokens k JOIN candidate_allocations a ON a.id=k.allocation_id JOIN registrations r ON r.id=a.registration_id WHERE r.user_id=?",
      [userId],
      c,
    );
    await query(
      "UPDATE notifications SET status='failed',payload_encrypted=NULL,error_code='ACCOUNT_DELETED' WHERE user_id=? AND status IN ('pending','sending')",
      [userId],
      c,
    );
    if (n) {
      await query(
        "UPDATE users SET status='disabled',deleted_at=UTC_TIMESTAMP(3),email=CONCAT('deleted-',id,'@deleted.invalid'),phone=NULL WHERE id=?",
        [userId],
        c,
      );
    } else {
      await query("DELETE FROM notifications WHERE user_id=?", [userId], c);
      await query("DELETE FROM students WHERE user_id=?", [userId], c);
      await query(
        "UPDATE candidate_allocations SET verified_by=NULL WHERE verified_by=?",
        [userId],
        c,
      );
      await query(
        "UPDATE audit_logs SET actor_id=NULL WHERE actor_id=?",
        [userId],
        c,
      );
      await query("DELETE FROM users WHERE id=?", [userId], c);
    }
    await audit(actor, "user.delete", userId, c);
    return { retainedExamRecords: !!n };
  });
}
export async function deleteExamination(actor, examId) {
  return transaction(async (c) => {
    const [exam] = await query(
      "SELECT * FROM examinations WHERE id=? FOR UPDATE",
      [examId],
      c,
    );
    if (!exam) fail(404, "Examination not found.");
    if (!["draft", "open", "closed"].includes(exam.status))
      fail(409, "Active or completed examinations cannot be deleted.");
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM registrations WHERE exam_id=?",
      [examId],
      c,
    );
    if (n)
      fail(
        409,
        "This examination has student registrations. Edit its schedule to postpone it instead of deleting student records.",
      );
    await query(
      "DELETE w FROM workstation_sessions w JOIN exam_slots s ON s.id=w.slot_id WHERE s.exam_id=?",
      [examId],
      c,
    );
    await query("DELETE FROM exam_slots WHERE exam_id=?", [examId], c);
    await query("DELETE FROM questions WHERE exam_id=?", [examId], c);
    await query(
      "UPDATE students SET selected_exam_id=NULL WHERE selected_exam_id=?",
      [examId],
      c,
    );
    await query("DELETE FROM examinations WHERE id=?", [examId], c);
    await audit(actor, "exam.delete", examId, c);
  });
}
export async function createSlot(actor, d) {
  return transaction(async (c) => {
    const [center] = await query(
      "SELECT * FROM exam_centers WHERE id=? FOR UPDATE",
      [d.centerId],
      c,
    );
    const [exam] = await query(
      "SELECT * FROM examinations WHERE id=?",
      [d.examId],
      c,
    );
    if (!center?.active) fail(400, "Select an active examination center.");
    if (!exam)
      fail(
        400,
        "The selected examination no longer exists. Refresh and select an examination.",
      );
    if (d.capacity > center.capacity)
      fail(
        400,
        `Candidate capacity exceeds the center limit of ${center.capacity}. Enter ${center.capacity} or fewer candidates.`,
      );
    if (
      nowMs(dateSql(d.endsAt)) - nowMs(dateSql(d.startsAt)) <
      exam.duration_minutes * 60000
    )
      fail(
        400,
        `This examination requires at least ${exam.duration_minutes} minutes. Choose an end time at least ${exam.duration_minutes} minutes after the start time.`,
      );
    const overlaps = await query(
      "SELECT id FROM exam_slots WHERE center_id=? AND starts_at<? AND ends_at>?",
      [d.centerId, dateSql(d.endsAt), dateSql(d.startsAt)],
      c,
    );
    if (overlaps.length)
      fail(409, "This center already has an overlapping slot.");
    const id = randomUUID();
    await query(
      "INSERT INTO exam_slots(id,exam_id,center_id,starts_at,ends_at,capacity) VALUES(?,?,?,?,?,?)",
      [
        id,
        d.examId,
        d.centerId,
        dateSql(d.startsAt),
        dateSql(d.endsAt),
        d.capacity,
      ],
      c,
    );
    await audit(actor, "slot.create", id, c);
    return { id };
  });
}
export async function allocate(actor, registrationId, slotId) {
  return transaction(async (c) => {
    const [slot] = await query(
      "SELECT s.*,e.status AS exam_status FROM exam_slots s JOIN examinations e ON e.id=s.exam_id WHERE s.id=? FOR UPDATE",
      [slotId],
      c,
    );
    const [reg] = await query(
      "SELECT r.*,u.status AS user_status,u.email_verified_at,u.phone_verified_at FROM registrations r JOIN users u ON u.id=r.user_id WHERE r.id=? FOR UPDATE",
      [registrationId],
      c,
    );
    const [center] = await query(
      "SELECT active FROM exam_centers WHERE id=?",
      [slot?.center_id || ""],
      c,
    );
    if (!slot)
      fail(404, "Examination slot not found. Select an existing slot.");
    if (!reg) fail(404, "Registration not found.");
    if (reg.exam_id !== slot.exam_id)
      fail(409, "Select a slot for the same examination as this registration.");
    if (slot.exam_status !== "closed")
      fail(
        409,
        "Close examination registration first: go to Examinations → Edit → set Status to Closed, then retry allocation.",
      );
    if (!center?.active)
      fail(
        409,
        "The selected center is inactive. Activate it under Centers before allocation.",
      );
    if (reg.status !== "completed")
      fail(
        409,
        "Complete this registration and any required simulated payment before allocation.",
      );
    if (reg.user_status !== "active" || !reg.email_verified_at)
      fail(
        409,
        "The candidate must have an active account and verified email before allocation.",
      );
    if (nowMs(slot.starts_at) <= Date.now())
      fail(
        409,
        "This slot has already started. Select a future slot or update its schedule.",
      );
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM candidate_allocations WHERE slot_id=?",
      [slot.id],
      c,
    );
    if (n >= slot.capacity) fail(409, "This slot has reached capacity.");
    const allocationId = randomUUID(),
      hallNumber = `HT-${randomUUID()}`;
    await query(
      "INSERT INTO candidate_allocations(id,registration_id,slot_id) VALUES(?,?,?)",
      [allocationId, reg.id, slot.id],
      c,
    );
    await query(
      "INSERT INTO hall_tickets(allocation_id,hall_number) VALUES(?,?)",
      [allocationId, hallNumber],
      c,
    );
    const notificationId = await issueActivation(
      allocationId,
      reg.user_id,
      reg.registration_number,
      hallNumber,
      c,
    );
    await audit(actor, "candidate.allocate", allocationId, c);
    return { allocationId, hallNumber, notificationId };
  });
}
export async function issueActivation(
  allocationId,
  userId,
  registrationNumber,
  hallNumber,
  c,
) {
  const [attempt] = await query(
    "SELECT id FROM exam_attempts WHERE allocation_id=?",
    [allocationId],
    c,
  );
  if (attempt)
    fail(
      409,
      "Examination credentials cannot change after the attempt starts.",
    );
  const value = token();
  const examPassword = token().slice(0, 24);
  const examPasswordHash = await bcrypt.hash(examPassword, 12);
  await query(
    "UPDATE hall_tickets SET exam_password_hash=? WHERE allocation_id=?",
    [examPasswordHash, allocationId],
    c,
  );
  await query(
    "DELETE FROM activation_tokens WHERE allocation_id=?",
    [allocationId],
    c,
  );
  await query(
    "INSERT INTO activation_tokens(token_hash,allocation_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR))",
    [digest(value), allocationId],
    c,
  );
  return enqueue(
    userId,
    "Hall ticket and examination credentials",
    `Your hall ticket and schedule are available in your EXAMPRO dashboard.\n\nRegistration ID: ${registrationNumber}\nHall ticket number: ${hallNumber}\nExamination password: ${examPassword}\n\nUse these details at ${appUrl()}/exam after signing in to your candidate account. This examination password is separate from your account password. If credentials were reissued, this password replaces your previous examination password. Keep this email private.\n\nOptional: set your own examination password within 24 hours using this single-use link: ${appUrl()}/exam-setup#${value}\nChanging the password makes the password printed in this email invalid.\n\nExamination access still requires invigilator verification, your assigned authorized workstation, an active examination and your scheduled slot. Report to the assigned center with identification.`,
    c,
    { allocationId, examPasswordHash },
  );
}
export async function setupExamPassword(value, password) {
  const hash = await bcrypt.hash(password, 12);
  await transaction(async (c) => {
    const [row] = await query(
      "SELECT * FROM activation_tokens WHERE token_hash=? AND consumed_at IS NULL AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE",
      [digest(value)],
      c,
    );
    if (!row)
      fail(
        400,
        "This activation link is expired or already used. Request a new link from the examination authority.",
      );
    const [attempt] = await query(
      "SELECT id FROM exam_attempts WHERE allocation_id=?",
      [row.allocation_id],
      c,
    );
    if (attempt)
      fail(
        409,
        "Examination credentials cannot change after the attempt starts.",
      );
    await query(
      "UPDATE hall_tickets SET exam_password_hash=? WHERE allocation_id=?",
      [hash, row.allocation_id],
      c,
    );
    await query(
      "UPDATE activation_tokens SET consumed_at=UTC_TIMESTAMP(3) WHERE token_hash=?",
      [digest(value)],
      c,
    );
  });
}
export async function verifyAndAssign(
  actor,
  allocationId,
  computerId,
  attendance,
) {
  await transaction(async (c) => {
    const [a] = await query(
      "SELECT a.*,s.center_id,s.ends_at FROM candidate_allocations a JOIN exam_slots s ON s.id=a.slot_id WHERE a.id=? FOR UPDATE",
      [allocationId],
      c,
    );
    if (!a) fail(404, "Allocation not found.");
    centerScope(actor, a.center_id);
    if (
      ["Exam Started", "Exam Submitted"].includes(a.attendance) ||
      nowMs(a.ends_at) < Date.now()
    )
      fail(409, "This allocation is locked.");
    if (attendance === "Verified") {
      const [pc] = await query(
        "SELECT * FROM computers WHERE id=? FOR UPDATE",
        [computerId],
        c,
      );
      if (!pc?.active || pc.center_id !== a.center_id)
        fail(400, "Select an active computer in the assigned center.");
      await query(
        "UPDATE candidate_allocations SET attendance='Verified',verified_by=?,verified_at=UTC_TIMESTAMP(3),computer_id=? WHERE id=?",
        [actor.id, pc.id, a.id],
        c,
      );
    } else
      await query(
        "UPDATE candidate_allocations SET attendance=?,verified_by=NULL,verified_at=NULL,computer_id=NULL WHERE id=?",
        [attendance, a.id],
        c,
      );
    await audit(actor.id, "candidate." + attendance.toLowerCase(), a.id, c);
  });
}
export async function enrollWorkstation(actor, slotId, computerId) {
  const value = token();
  const expires = await transaction(async (c) => {
    const [slot] = await query(
      "SELECT * FROM exam_slots WHERE id=?",
      [slotId],
      c,
    );
    const [pc] = await query(
      "SELECT * FROM computers WHERE id=? FOR UPDATE",
      [computerId],
      c,
    );
    if (
      !slot ||
      !pc?.active ||
      pc.center_id !== slot.center_id ||
      nowMs(slot.ends_at) <= Date.now()
    )
      fail(400, "Invalid workstation or expired slot.");
    centerScope(actor, slot.center_id);
    const [attempt] = await query(
      "SELECT t.id FROM exam_attempts t JOIN candidate_allocations a ON a.id=t.allocation_id WHERE a.computer_id=? AND a.slot_id=? AND t.status='in_progress'",
      [pc.id, slot.id],
      c,
    );
    if (attempt) fail(409, "A live attempt is using this workstation.");
    await query(
      "DELETE FROM workstation_sessions WHERE computer_id=? AND slot_id=?",
      [pc.id, slot.id],
      c,
    );
    const end = Math.min(nowMs(slot.ends_at), Date.now() + 8 * 3600000);
    await query(
      "INSERT INTO workstation_sessions(token_hash,computer_id,slot_id,expires_at,issued_by) VALUES(?,?,?,?,?)",
      [digest(value), pc.id, slot.id, dateSql(end), actor.id],
      c,
    );
    await audit(actor.id, "workstation.enroll", pc.id, c);
    return end;
  });
  return { value, expires };
}
export async function saveQuestion(actor, d, questionId) {
  return transaction(async (c) => {
    const [exam] = await query(
      "SELECT * FROM examinations WHERE id=? FOR UPDATE",
      [d.examId],
      c,
    );
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM exam_attempts t JOIN candidate_allocations a ON a.id=t.allocation_id JOIN registrations r ON r.id=a.registration_id WHERE r.exam_id=?",
      [d.examId],
      c,
    );
    if (!exam || ["active", "completed"].includes(exam.status) || n)
      fail(
        409,
        "Questions are locked when an examination is active or has attempts.",
      );
    const id = questionId || randomUUID();
    if (questionId) {
      const [old] = await query(
        "SELECT id FROM questions WHERE id=? AND exam_id=?",
        [id, d.examId],
        c,
      );
      if (!old) fail(404, "Question not found in this examination.");
      await query(
        "UPDATE questions SET type=?,prompt=?,marks=?,negative_marks=?,position=? WHERE id=?",
        [d.type, d.prompt, d.marks, d.negativeMarks, d.position, id],
        c,
      );
      await query("DELETE FROM question_options WHERE question_id=?", [id], c);
    } else
      await query(
        "INSERT INTO questions(id,exam_id,type,prompt,marks,negative_marks,position) VALUES(?,?,?,?,?,?,?)",
        [id, d.examId, d.type, d.prompt, d.marks, d.negativeMarks, d.position],
        c,
      );
    for (const option of d.options)
      await query(
        "INSERT INTO question_options(question_id,option_id,option_text) VALUES(?,?,?)",
        [id, option.id, option.text],
        c,
      );
    await query(
      "INSERT INTO answer_keys(question_id,correct_answer,tolerance) VALUES(?,?,?) ON DUPLICATE KEY UPDATE correct_answer=VALUES(correct_answer),tolerance=VALUES(tolerance)",
      [id, JSON.stringify(d.correctAnswer), d.tolerance],
      c,
    );
    await audit(actor, "question.save", id, c);
    return { id };
  });
}
