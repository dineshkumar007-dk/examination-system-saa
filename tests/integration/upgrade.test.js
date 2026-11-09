import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import request from "supertest";
import bcrypt from "bcrypt";
import app from "../../app.js";
import { query, closeDatabase } from "../../backend/src/config/database.js";
import { digest, dateSql } from "../../backend/src/utils/security.js";
import * as exams from "../../backend/src/services/exams.js";
import { myRegistrations } from "../../backend/src/services/registrations.js";
import { powerpointFixture } from "../helpers/powerpoint-fixture.js";
import { rateLimit } from "../../backend/src/middleware/security.js";
const enabled = process.env.INTEGRATION_TESTS === "true";
test(
  "REAL MySQL + HTTP: assigned examiner PowerPoint workflow, cross-role isolation and student evaluation",
  { skip: !enabled },
  async () => {
    assert.match(
      process.env.DB_NAME,
      /^exampro_upgrade_[a-f0-9]{8}_test$/,
      "Use this upgrade's isolated test database",
    );
    process.env.APP_URL = "http://localhost:3000";
    const ids = Array.from({ length: 11 }, () => randomUUID()),
      [
        admin,
        examiner,
        other,
        student,
        examId,
        center,
        pc,
        slot,
        registration,
        allocation,
      ] = ids;
    const password = "Isolated-integration-password",
      hash = await bcrypt.hash(password, 4);
    const metrics = {
      recordedAt: new Date().toISOString(),
      database: "isolated test database",
      note: "HTTP timings include managed-DB network RTT; fixture passwords use bcrypt cost 4, not production cost 12.",
      ms: {},
    };
    let paperId, cs, es, os, ss;
    async function session(role, id) {
      const agent = request.agent(app);
      const csrf = await agent.get("/api/csrf").expect(200);
      const start = performance.now();
      const logged = await agent
        .post("/api/auth/" + (role === "candidate" ? "login" : role + "-login"))
        .set("Origin", process.env.APP_URL)
        .set("X-CSRF-Token", csrf.body.token)
        .send({ identity: `${id}@example.invalid`, password })
        .expect(200);
      metrics.ms[role + "HttpLogin"] = Number(
        (performance.now() - start).toFixed(2),
      );
      return {
        agent,
        headers: {
          Origin: process.env.APP_URL,
          "X-CSRF-Token": csrf.body.token,
          ...(logged.body.adminAccess
            ? { "X-Admin-Access": logged.body.adminAccess }
            : {}),
        },
      };
    }
    const post = (s, url, body) => s.agent.post(url).set(s.headers).send(body);
    const put = (s, url, body) => s.agent.put(url).set(s.headers).send(body);
    try {
      const bucket = "upgrade-rate-" + randomUUID();
      const attempts = await Promise.allSettled(
        Array.from({ length: 20 }, () => rateLimit(bucket, 5, 60)),
      );
      assert.equal(attempts.filter((v) => v.status === "fulfilled").length, 5);
      assert.ok(
        attempts
          .filter((v) => v.status === "rejected")
          .every((v) => v.reason.status === 429),
      );
      await query(
        "UPDATE rate_limits SET resets_at='2000-01-01' WHERE bucket_key=?",
        [digest("rate:" + bucket)],
      );
      await rateLimit(bucket, 5, 60);
      await query("DELETE FROM rate_limits WHERE bucket_key=?", [
        digest("rate:" + bucket),
      ]);
      for (const [id, role] of [
        [admin, "admin"],
        [examiner, "examiner"],
        [other, "examiner"],
        [student, "candidate"],
      ])
        await query(
          "INSERT INTO users(id,name,email,password_hash,role,status,email_verified_at) VALUES(?,'Upgrade fixture',?,?,?,'active',UTC_TIMESTAMP(3))",
          [id, `${id}@example.invalid`, hash, role],
        );
      await query(
        "INSERT INTO students(user_id,dob,address) VALUES(?,'2000-01-01','Isolated test address')",
        [student],
      );
      await query(
        "INSERT INTO examinations(id,name,description,instructions,duration_minutes,registration_start,registration_end,fee,status) VALUES(?,'Upgrade fixture','Fixture','Read every question carefully.',10,?,?,0,'open')",
        [examId, dateSql(Date.now() - 3600000), dateSql(Date.now() + 3600000)],
      );
      cs = await session("admin", admin);
      es = await session("examiner", examiner);
      os = await session("examiner", other);
      ss = await session("candidate", student);
      for (const s of [cs, ss]) {
        await s.agent.get("/api/examiner/papers").set(s.headers).expect(403);
        await post(s, "/api/examiner/papers", {}).expect(403);
        await post(s, `/api/examiner/papers/${randomUUID()}/upload`, {}).expect(
          403,
        );
        await post(s, "/api/manage/questions", {}).expect(403);
      }
      await es.agent.get("/api/manage/users").expect(403);
      await post(es, "/api/manage/staff", {}).expect(403);
      await request(app).get("/api/examiner/papers").expect(401);
      await put(cs, `/api/manage/examinations/${examId}/examiner`, {
        examinerId: examiner,
      }).expect(200);
      const created = await post(es, "/api/examiner/papers", {
        examId,
        title: "Imported MCQ paper",
        subject: "Computing",
        description: "Integration fixture",
        durationMinutes: 10,
        totalMarks: 2,
      }).expect(201);
      paperId = created.body.id;
      await os.agent.get(`/api/examiner/papers/${paperId}`).expect(404);
      await put(os, `/api/examiner/papers/${paperId}`, {
        expectedRevision: 1,
        title: "Imported MCQ paper",
        subject: "Computing",
        description: "Fixture",
        durationMinutes: 10,
        totalMarks: 2,
        document: {
          questions: [],
          issues: [],
          slideCount: 0,
          resolutions: {},
          reviewed: false,
        },
      }).expect(404);
      const source = await powerpointFixture({ image: true });
      const uploaded = await es.agent
        .post(
          `/api/examiner/papers/${paperId}/upload?filename=fixture.pptx&revision=1`,
        )
        .set(es.headers)
        .set("Content-Type", "application/octet-stream")
        .send(source)
        .expect(200);
      assert.equal(uploaded.body.document.questions.length, 2);
      assert.ok(
        uploaded.body.document.questions.every((q) => q.answer === null),
      );
      await os.agent.get(`/api/examiner/papers/${paperId}/source`).expect(404);
      await es.agent.get(`/api/examiner/papers/${paperId}/source`).expect(200);
      await es.agent
        .post(
          `/api/examiner/papers/${paperId}/upload?filename=x.pptx&revision=1`,
        )
        .set(es.headers)
        .set("Content-Type", "application/octet-stream")
        .send(source)
        .expect(409);
      const key = await post(es, `/api/examiner/papers/${paperId}/key`, {
        text: "1) B\n2) A",
      }).expect(200);
      assert.deepEqual(key.body, { 1: "B", 2: "A" });
      const metadata = {
        title: "Imported MCQ paper",
        subject: "Computing",
        description: "Integration fixture",
        durationMinutes: 10,
        totalMarks: 2,
      };
      const document = uploaded.body.document;
      document.reviewed = true;
      await put(es, `/api/examiner/papers/${paperId}`, {
        ...metadata,
        expectedRevision: 2,
        document,
      }).expect(200);
      await post(es, `/api/examiner/papers/${paperId}/publish`, {
        expectedRevision: 3,
      }).expect(400);
      document.questions.forEach((q) => (q.answer = key.body[q.number]));
      await put(es, `/api/examiner/papers/${paperId}`, {
        ...metadata,
        expectedRevision: 3,
        document,
      }).expect(200);
      await post(es, `/api/examiner/papers/${paperId}/publish`, {
        expectedRevision: 4,
      }).expect(200);
      await put(es, `/api/examiner/papers/${paperId}`, {
        ...metadata,
        expectedRevision: 5,
        document,
      }).expect(409);
      await es.agent
        .delete(`/api/examiner/papers/${paperId}`)
        .set(es.headers)
        .expect(409);
      await query(
        "INSERT INTO exam_centers(id,name,address,city,state,capacity) VALUES(?,'Fixture center','Fixture address','Fixture city','Fixture state',10)",
        [center],
      );
      await query(
        "INSERT INTO computers(id,center_id,label) VALUES(?,?,'Fixture computer')",
        [pc, center],
      );
      await query(
        "INSERT INTO exam_slots(id,exam_id,center_id,starts_at,ends_at,capacity) VALUES(?,?,?,?,?,10)",
        [
          slot,
          examId,
          center,
          dateSql(Date.now() - 60000),
          dateSql(Date.now() + 3600000),
        ],
      );
      await query(
        "INSERT INTO registrations(id,registration_number,application_number,user_id,exam_id,status) VALUES(?,?,?,?,?,'completed')",
        [
          registration,
          "EXP-" + registration,
          "APP-" + registration,
          student,
          examId,
        ],
      );
      await query(
        "INSERT INTO candidate_allocations(id,registration_id,slot_id,attendance,verified_by,verified_at,computer_id) VALUES(?,?,?,'Verified',?,UTC_TIMESTAMP(3),?)",
        [allocation, registration, slot, admin, pc],
      );
      await query(
        "INSERT INTO hall_tickets(allocation_id,hall_number,exam_password_hash) VALUES(?,?,?)",
        [allocation, "HT-" + allocation, hash],
      );
      const workstation = randomUUID();
      await query(
        "INSERT INTO workstation_sessions(token_hash,computer_id,slot_id,expires_at,issued_by) VALUES(?,?,?,?,?)",
        [digest(workstation), pc, slot, dateSql(Date.now() + 3600000), admin],
      );
      await query("UPDATE examinations SET status='active' WHERE id=?", [
        examId,
      ]);
      const login = await exams.examLogin(
        student,
        "EXP-" + registration,
        "HT-" + allocation,
        password,
        workstation,
      );
      let start = performance.now();
      const attempt = await exams.getAttempt(
        student,
        login.access,
        workstation,
      );
      metrics.ms.questionRetrieval = Number(
        (performance.now() - start).toFixed(2),
      );
      assert.equal(attempt.questions.length, 2);
      assert.ok(!JSON.stringify(attempt).includes("correct_answer"));
      assert.ok(attempt.questions[0].media.length);
      start = performance.now();
      const status = await exams.getAttempt(
        student,
        login.access,
        workstation,
        true,
      );
      metrics.ms.statusPolling = Number((performance.now() - start).toFixed(2));
      assert.equal(status.questions, undefined);
      for (const [i, q] of attempt.questions.entries())
        await exams.saveAnswer(student, login.access, workstation, {
          questionId: q.id,
          answer: [i === 0 ? "B" : "A"],
          review: false,
          expectedRevision: 0,
        });
      start = performance.now();
      await exams.submitAttempt(student, login.access, workstation);
      metrics.ms.submitAttempt = Number((performance.now() - start).toFixed(2));
      assert.equal(
        (await exams.submitAttempt(student, login.access, workstation))
          .submitted,
        true,
      );
      await exams.evaluate(admin, examId);
      const [score] = await query(
        "SELECT rs.score,rs.status FROM results rs JOIN exam_attempts t ON t.id=rs.attempt_id WHERE t.id=?",
        [login.id],
      );
      assert.equal(score.score, 2);
      assert.equal((await myRegistrations(student))[0].score, null);
      await query("UPDATE examinations SET status='completed' WHERE id=?", [
        examId,
      ]);
      await exams.publish(admin, examId);
      assert.equal((await myRegistrations(student))[0].score, 2);
      await mkdir("docs/performance", { recursive: true });
      await writeFile(
        "docs/performance/integration.json",
        JSON.stringify(metrics, null, 2) + "\n",
      );
      console.log("Isolated upgrade timings:", JSON.stringify(metrics.ms));
    } finally {
      // Only UUID-linked fixtures in the explicitly named disposable test DB are removed.
      await query(
        "DELETE sa FROM student_answers sa JOIN exam_attempts t ON t.id=sa.attempt_id WHERE t.allocation_id=?",
        [allocation],
      );
      await query(
        "DELETE rs FROM results rs JOIN exam_attempts t ON t.id=rs.attempt_id WHERE t.allocation_id=?",
        [allocation],
      );
      await query("DELETE FROM exam_attempts WHERE allocation_id=?", [
        allocation,
      ]);
      await query("DELETE FROM workstation_sessions WHERE slot_id=?", [slot]);
      await query("DELETE FROM hall_tickets WHERE allocation_id=?", [
        allocation,
      ]);
      await query("DELETE FROM candidate_allocations WHERE id=?", [allocation]);
      await query("DELETE FROM registrations WHERE id=?", [registration]);
      await query("DELETE FROM question_papers WHERE exam_id=?", [examId]);
      await query("DELETE FROM examiner_assignments WHERE exam_id=?", [examId]);
      await query("DELETE FROM questions WHERE exam_id=?", [examId]);
      await query("DELETE FROM exam_slots WHERE id=?", [slot]);
      await query("DELETE FROM computers WHERE id=?", [pc]);
      await query("DELETE FROM exam_centers WHERE id=?", [center]);
      await query("DELETE FROM examinations WHERE id=?", [examId]);
      for (const uid of [admin, examiner, other, student]) {
        await query("DELETE FROM notifications WHERE user_id=?", [uid]);
        await query("DELETE FROM students WHERE user_id=?", [uid]);
        await query("DELETE FROM sessions WHERE user_id=?", [uid]);
        await query("DELETE FROM audit_logs WHERE actor_id=?", [uid]);
        await query("DELETE FROM users WHERE id=?", [uid]);
      }
      await closeDatabase();
    }
  },
);
