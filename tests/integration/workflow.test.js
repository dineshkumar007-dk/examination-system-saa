// Real MySQL integration, isolated fixture identities, NO email/SMS delivery claimed.
// Requires an already migrated disposable database whose name ends in _test.
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { query, closeDatabase } from "../../backend/src/config/database.js";
import { dateSql } from "../../backend/src/utils/security.js";
import {
  register,
  myRegistrations,
  simulatePayment,
} from "../../backend/src/services/registrations.js";
import {
  allocate,
  createSlot,
  verifyAndAssign,
  enrollWorkstation,
  saveQuestion,
} from "../../backend/src/services/administration.js";
import {
  examLogin,
  getAttempt,
  saveAnswer,
  finalizeExpired,
  evaluate,
  publish,
} from "../../backend/src/services/exams.js";
import { login } from "../../backend/src/services/auth.js";
import { rateLimit } from "../../backend/src/middleware/security.js";
const enabled = process.env.INTEGRATION_TESTS === "true";
test(
  "REAL MySQL: constraints, payment, allocation race, exam access, isolation, answer revisions, expiry, delayed results and persistence",
  { skip: !enabled },
  async () => {
    assert.match(
      process.env.DB_NAME,
      /_test$/,
      "Use a disposable database ending in _test",
    );
    const suffix = randomUUID(),
      users = [randomUUID(), randomUUID()],
      adminId = randomUUID(),
      examId = randomUUID(),
      centerId = randomUUID(),
      pcId = randomUUID();
    const fixturePassword = "integration-password-" + suffix;
    const hash = await bcrypt.hash(fixturePassword, 4);
    let allocations = [];
    try {
      await query(
        "INSERT INTO users(id,name,email,password_hash,role,status,email_verified_at) VALUES(?,'Test operator',?,?,'admin','active',UTC_TIMESTAMP(3))",
        [adminId, `operator-${suffix}@example.invalid`, hash],
      );
      for (let i = 0; i < users.length; i++) {
        await query(
          "INSERT INTO users(id,name,email,phone,password_hash,status,email_verified_at,phone_verified_at) VALUES(?,'Integration candidate',?,?,?,'active',UTC_TIMESTAMP(3),NULL)",
          [
            users[i],
            `candidate-${i}-${suffix}@example.invalid`,
            "+1" + String(Date.now()).slice(-9) + i,
            hash,
          ],
        );
        await query(
          "INSERT INTO students(user_id,dob,address) VALUES(?,'2000-01-01','Isolated integration test fixture')",
          [users[i]],
        );
      }
      await query(
        "INSERT INTO examinations(id,name,description,instructions,duration_minutes,registration_start,registration_end,fee,status) VALUES(?,'Integration exam','Test fixture','Follow invigilator instructions.',30,?,?,100,'open')",
        [examId, dateSql(Date.now() - 3600000), dateSql(Date.now() + 3600000)],
      );
      const registrations = await Promise.all(
        users.map((u) => register(u, examId)),
      );
      await assert.rejects(
        register(users[0], examId),
        (e) => e.code === "ER_DUP_ENTRY",
      );
      assert.equal(registrations[0].status, "payment_pending");
      await simulatePayment(users[0], registrations[0].id, "Failed");
      assert.equal(
        (await myRegistrations(users[0]))[0].status,
        "payment_pending",
      );
      for (let i = 0; i < 2; i++)
        await simulatePayment(users[i], registrations[i].id, "Successful");
      await query(
        "INSERT INTO exam_centers(id,name,address,city,state,capacity) VALUES(?,'Test center','Test address','Test city','Test state',1)",
        [centerId],
      );
      await query(
        "INSERT INTO computers(id,center_id,label) VALUES(?,?,'TEST-PC')",
        [pcId, centerId],
      );
      const slot = await createSlot(adminId, {
        examId,
        centerId,
        startsAt: new Date(Date.now() + 60000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        capacity: 1,
      });
      await query("UPDATE examinations SET status='closed' WHERE id=?", [
        examId,
      ]);
      const races = await Promise.allSettled(
        registrations.map((r) => allocate(adminId, r.id, slot.id)),
      );
      assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(races.filter((r) => r.status === "rejected").length, 1);
      allocations = races
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value.allocationId);
      const winner = races.findIndex((r) => r.status === "fulfilled"),
        uid = users[winner],
        reg = registrations[winner],
        hall = races[winner].value.hallNumber;
      const question = await saveQuestion(adminId, {
        examId,
        type: "MCQ",
        prompt: "Select the correct test option.",
        options: [
          { id: "A", text: "First" },
          { id: "B", text: "Second" },
        ],
        correctAnswer: ["A"],
        tolerance: 0,
        marks: 2,
        negativeMarks: 0.5,
        position: 1,
      });
      await query(
        "UPDATE hall_tickets SET exam_password_hash=? WHERE allocation_id=?",
        [hash, allocations[0]],
      );
      await assert.rejects(
        examLogin(uid, reg.registrationNumber, hall, fixturePassword, ""),
      );
      const actor = { id: adminId, role: "admin" };
      await verifyAndAssign(actor, allocations[0], pcId, "Verified");
      const workstation = await enrollWorkstation(actor, slot.id, pcId);
      await query("UPDATE exam_slots SET starts_at=? WHERE id=?", [
        dateSql(Date.now() - 10000),
        slot.id,
      ]);
      await query("UPDATE examinations SET status='active' WHERE id=?", [
        examId,
      ]);
      const session = await examLogin(
        uid,
        reg.registrationNumber,
        hall,
        fixturePassword,
        workstation.value,
      );
      const payload = await getAttempt(uid, session.access, workstation.value);
      assert.equal(payload.questions.length, 1);
      assert.ok(!JSON.stringify(payload).includes("correct_answer"));
      assert.ok(!JSON.stringify(payload).includes("password_hash"));
      await assert.rejects(
        getAttempt(users[1 - winner], session.access, workstation.value),
      );
      const saved = await saveAnswer(uid, session.access, workstation.value, {
        questionId: question.id,
        answer: ["A"],
        review: true,
        expectedRevision: 0,
      });
      assert.equal(saved.revision, 1);
      const retried = await saveAnswer(uid, session.access, workstation.value, {
        questionId: question.id,
        answer: ["A"],
        review: true,
        expectedRevision: 0,
      });
      assert.equal(retried.revision, 1);
      await assert.rejects(
        saveAnswer(uid, session.access, workstation.value, {
          questionId: question.id,
          answer: ["B"],
          review: false,
          expectedRevision: 0,
        }),
      );
      await closeDatabase();
      const restored = await getAttempt(uid, session.access, workstation.value);
      assert.deepEqual(restored.answers[0].answer, ["A"]);
      await query("UPDATE exam_attempts SET deadline=? WHERE id=?", [
        dateSql(Date.now() - 1000),
        session.id,
      ]);
      await finalizeExpired();
      assert.ok(
        (await getAttempt(uid, session.access, workstation.value)).submitted,
      );
      const locked = await saveAnswer(uid, session.access, workstation.value, {
        questionId: question.id,
        answer: ["B"],
        review: false,
        expectedRevision: 1,
      });
      assert.equal(locked.submitted, true);
      const [answer] = await query(
        "SELECT answer FROM student_answers WHERE attempt_id=?",
        [session.id],
      );
      assert.deepEqual(answer.answer, ["A"]);
      await evaluate(adminId, examId);
      assert.equal((await myRegistrations(uid))[0].score, null);
      await query("UPDATE examinations SET status='completed' WHERE id=?", [
        examId,
      ]);
      await publish(adminId, examId);
      assert.equal((await myRegistrations(uid))[0].score, 2);
      assert.equal(
        (
          await login(
            `candidate-${winner}-${suffix}@example.invalid`,
            fixturePassword,
          )
        ).id,
        uid,
      );
      await assert.rejects(login("unknown@example.invalid", fixturePassword));
      const rateKey = "integration-" + suffix;
      await rateLimit(rateKey, 1, 60);
      await assert.rejects(rateLimit(rateKey, 1, 60), (e) => e.status === 429);
      assert.ok(restored.deadline > 0);
    } finally {
      // Only this test's UUID-linked records are removed, never broad application data.
      for (const uid of [adminId, ...users])
        await query("DELETE FROM audit_logs WHERE actor_id=?", [uid]);
      for (const uid of users)
        await query("DELETE FROM notifications WHERE user_id=?", [uid]);
      const attempts = await query(
        "SELECT t.id FROM exam_attempts t JOIN candidate_allocations a ON a.id=t.allocation_id JOIN registrations r ON r.id=a.registration_id WHERE r.exam_id=?",
        [examId],
      );
      for (const a of attempts) {
        await query("DELETE FROM student_answers WHERE attempt_id=?", [a.id]);
        await query("DELETE FROM results WHERE attempt_id=?", [a.id]);
        await query("DELETE FROM exam_attempts WHERE id=?", [a.id]);
      }
      for (const a of allocations) {
        await query("DELETE FROM activation_tokens WHERE allocation_id=?", [a]);
        await query("DELETE FROM hall_tickets WHERE allocation_id=?", [a]);
        await query("DELETE FROM candidate_allocations WHERE id=?", [a]);
      }
      await query("DELETE FROM workstation_sessions WHERE issued_by=?", [
        adminId,
      ]);
      await query("DELETE FROM exam_slots WHERE exam_id=?", [examId]);
      await query("DELETE FROM computers WHERE id=?", [pcId]);
      await query("DELETE FROM exam_centers WHERE id=?", [centerId]);
      const questions = await query(
        "SELECT id FROM questions WHERE exam_id=?",
        [examId],
      );
      for (const q of questions) {
        await query("DELETE FROM question_options WHERE question_id=?", [q.id]);
        await query("DELETE FROM answer_keys WHERE question_id=?", [q.id]);
        await query("DELETE FROM questions WHERE id=?", [q.id]);
      }
      for (const uid of users) {
        await query("DELETE FROM payments WHERE user_id=?", [uid]);
        await query("DELETE FROM registrations WHERE user_id=?", [uid]);
        await query("DELETE FROM students WHERE user_id=?", [uid]);
        await query("DELETE FROM users WHERE id=?", [uid]);
      }
      await query("DELETE FROM examinations WHERE id=?", [examId]);
      await query("DELETE FROM users WHERE id=?", [adminId]);
      await closeDatabase();
    }
  },
);
