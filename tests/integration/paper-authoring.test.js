import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import app from "../../app.js";
import { query, closeDatabase } from "../../backend/src/config/database.js";
import { pdfFixture } from "../helpers/pdf-fixture.js";

test(
  "REAL MySQL + HTTP: manual and PDF papers save, review and publish with examiner isolation",
  { skip: process.env.INTEGRATION_TESTS !== "true", timeout: 120000 },
  async () => {
    assert.match(process.env.DB_NAME, /^exampro_upgrade_[a-f0-9]{8}_test$/);
    process.env.APP_URL = "http://localhost:3000";
    const [owner, other, student, manualExam, pdfExam] = Array.from(
      { length: 5 },
      () => randomUUID(),
    );
    const password = "Authoring-fixture-password";
    async function session(id, role) {
      const agent = request.agent(app);
      const token = (await agent.get("/api/csrf").expect(200)).body.token;
      await agent
        .post(`/api/auth/${role === "candidate" ? "login" : role + "-login"}`)
        .set("Origin", process.env.APP_URL)
        .set("X-CSRF-Token", token)
        .send({ identity: `${id}@example.invalid`, password })
        .expect(200);
      return {
        agent,
        headers: { Origin: process.env.APP_URL, "X-CSRF-Token": token },
      };
    }
    const metadata = {
      title: "Authoring paper",
      subject: "Maths",
      description: "Isolated fixture",
      durationMinutes: 10,
      totalMarks: 2,
    };
    try {
      const hash = await bcrypt.hash(password, 4);
      for (const [id, role] of [
        [owner, "examiner"],
        [other, "examiner"],
        [student, "candidate"],
      ])
        await query(
          "INSERT INTO users(id,name,email,password_hash,role,status,email_verified_at) VALUES(?,'Authoring fixture',?,?,?,'active',UTC_TIMESTAMP(3))",
          [id, `${id}@example.invalid`, hash, role],
        );
      for (const id of [manualExam, pdfExam]) {
        await query(
          "INSERT INTO examinations(id,name,description,instructions,duration_minutes,registration_start,registration_end,fee,status) VALUES(?,'Authoring fixture','Test','Read all questions.',10,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),0,'open')",
          [id],
        );
        await query(
          "INSERT INTO examiner_assignments(exam_id,examiner_id) VALUES(?,?)",
          [id, owner],
        );
      }
      const es = await session(owner, "examiner"),
        os = await session(other, "examiner"),
        cs = await session(student, "candidate");
      const create = (examId, authoringMode) =>
        es.agent
          .post("/api/examiner/papers")
          .set(es.headers)
          .send({ examId, authoringMode, ...metadata });
      const created = await create(manualExam, "manual").expect(201);
      const manual = created.body.id;
      const initial = await es.agent
        .get(`/api/examiner/papers/${manual}`)
        .expect(200);
      assert.equal(initial.body.document.mode, "manual");
      const document = {
        ...initial.body.document,
        reviewed: true,
        questions: [1, 2].map((number) => ({
          number,
          prompt: `Manual question ${number}: choose four`,
          options: [
            { id: "A", text: "Four" },
            { id: "B", text: "Five" },
          ],
          answer: null,
          marks: 1,
          negativeMarks: 0,
          media: [],
          slides: [],
        })),
      };
      const save = (id, revision, document) =>
        es.agent
          .put(`/api/examiner/papers/${id}`)
          .set(es.headers)
          .send({ ...metadata, document, expectedRevision: revision });
      await save(manual, 1, document).expect(200);
      await save(manual, 1, document).expect(409);
      await es.agent
        .post(`/api/examiner/papers/${manual}/publish`)
        .set(es.headers)
        .send({ expectedRevision: 2 })
        .expect(400);
      document.questions.forEach((q) => {
        q.answer = "A";
      });
      await save(manual, 2, document).expect(200);
      await es.agent
        .post(`/api/examiner/papers/${manual}/publish`)
        .set(es.headers)
        .send({ expectedRevision: 3 })
        .expect(200);
      const manualQuestions = await query(
        "SELECT prompt,slide_number FROM questions WHERE exam_id=? ORDER BY position",
        [manualExam],
      );
      assert.equal(manualQuestions.length, 2);
      assert.equal(manualQuestions[0].prompt, document.questions[0].prompt);
      assert.equal(manualQuestions[0].slide_number, null);
      const choices = await query(
        "SELECT o.option_text FROM question_options o JOIN questions q ON q.id=o.question_id WHERE q.exam_id=? ORDER BY q.position,o.option_id",
        [manualExam],
      );
      assert.deepEqual(
        choices.map((o) => o.option_text),
        ["Four", "Five", "Four", "Five"],
      );
      await save(manual, 4, document).expect(409);
      const uploadedDraft = await create(pdfExam, "upload").expect(201);
      const pdfId = uploadedDraft.body.id;
      const uploaded = await es.agent
        .post(
          `/api/examiner/papers/${pdfId}/upload?filename=maths.pdf&revision=1`,
        )
        .set(es.headers)
        .set("Content-Type", "application/pdf")
        .send(await pdfFixture())
        .expect(200);
      assert.equal(uploaded.body.document.slideCount, 2);
      await es.agent
        .get(`/api/examiner/papers/${pdfId}/slides/1`)
        .expect(200)
        .expect("Content-Type", /image\/png/);
      await os.agent.get(`/api/examiner/papers/${pdfId}/slides/1`).expect(404);
      await cs.agent.get(`/api/examiner/papers/${pdfId}/source`).expect(403);
      await request(app)
        .get(`/api/examiner/papers/${pdfId}/slides/1`)
        .expect(401);
      const pdfDoc = uploaded.body.document;
      pdfDoc.reviewed = true;
      pdfDoc.questions.forEach((q) => {
        q.answer = "B";
      });
      await save(pdfId, 2, pdfDoc).expect(200);
      await es.agent
        .post(`/api/examiner/papers/${pdfId}/publish`)
        .set(es.headers)
        .send({ expectedRevision: 3 })
        .expect(200);
      const pdfQuestions = await query(
        "SELECT slide_number FROM questions WHERE exam_id=? ORDER BY position",
        [pdfExam],
      );
      assert.deepEqual(
        pdfQuestions.map((q) => q.slide_number),
        [1, 2],
      );
    } finally {
      try {
        for (const exam of [manualExam, pdfExam]) {
          await query("DELETE FROM questions WHERE exam_id=?", [exam]);
          await query("DELETE FROM question_papers WHERE exam_id=?", [exam]);
          await query("DELETE FROM examiner_assignments WHERE exam_id=?", [
            exam,
          ]);
          await query("DELETE FROM examinations WHERE id=?", [exam]);
        }
        for (const id of [owner, other, student]) {
          await query("DELETE FROM sessions WHERE user_id=?", [id]);
          await query("DELETE FROM audit_logs WHERE actor_id=?", [id]);
          await query("DELETE FROM users WHERE id=?", [id]);
        }
      } finally {
        await closeDatabase();
      }
    }
  },
);
