// Isolated transaction/repository mocks; these do not prove real MySQL concurrency.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { dateSql } from "../backend/src/utils/security.js";
process.env.APP_SECRET = "e".repeat(64);
const state = {
  attempt: null,
  row: null,
  answer: null,
  finalized: false,
  queries: [],
};
mock.module("../backend/src/config/database.js", {
  namedExports: {
    transaction: async (fn) => {
      const snapshot = structuredClone(state);
      try {
        return await fn({});
      } catch (e) {
        Object.assign(state, snapshot);
        throw e;
      }
    },
    query: async (sql, args) => {
      state.queries.push(sql);
      if (sql.startsWith("SELECT t.*"))
        return args[1] === "owner" ? [structuredClone(state.attempt)] : [];
      if (sql.startsWith("SELECT a.*")) return [structuredClone(state.row)];
      if (sql.startsWith("SELECT * FROM workstation_sessions"))
        return [
          {
            computer_id: "pc",
            slot_id: "slot",
            expires_at: dateSql(Date.now() + 3600000),
          },
        ];
      if (sql.startsWith("SELECT id,type,prompt"))
        return [
          {
            id: "question",
            type: "MCQ",
            prompt: "Question",
            marks: 1,
            negative_marks: 0,
            position: 1,
          },
        ];
      if (sql.startsWith("SELECT o.question_id"))
        return [{ question_id: "question", id: "A", text: "First" }];
      if (sql.startsWith("SELECT question_id,answer"))
        return state.answer ? [structuredClone(state.answer)] : [];
      if (sql.startsWith("SELECT id,type FROM questions"))
        return args[0] === "question" ? [{ id: "question", type: "MCQ" }] : [];
      if (sql.startsWith("SELECT option_id"))
        return [{ option_id: "A" }, { option_id: "B" }];
      if (sql.startsWith("SELECT * FROM student_answers"))
        return state.answer ? [structuredClone(state.answer)] : [];
      if (sql.startsWith("INSERT INTO student_answers")) {
        state.answer = {
          question_id: args[1],
          answer: JSON.parse(args[2]),
          review: args[3],
          revision: args[4],
        };
        return {};
      }
      if (sql.startsWith("UPDATE exam_attempts")) {
        state.attempt.status = "submitted";
        state.finalized = true;
        return {};
      }
      if (
        sql.startsWith("UPDATE candidate_allocations") ||
        sql.startsWith("INSERT IGNORE INTO results")
      )
        return {};
      throw new Error("Unhandled isolated query: " + sql);
    },
  },
});
const exams = await import("../backend/src/services/exams.js");
function setup() {
  state.attempt = {
    id: "attempt",
    allocation_id: "allocation",
    status: "in_progress",
    deadline: dateSql(Date.now() + 3600000),
  };
  state.row = {
    exam_id: "exam",
    registration_status: "completed",
    user_status: "active",
    email_verified_at: "yes",
    phone_verified_at: null,
    exam_status: "active",
    center_active: 1,
    computer_active: 1,
    verified_at: "yes",
    attendance: "Exam Started",
    computer_id: "pc",
    slot_id: "slot",
    starts_at: dateSql(Date.now() - 10000),
    ends_at: dateSql(Date.now() + 3600000),
    candidate_name: "Candidate",
    exam_name: "Examination",
  };
  state.answer = null;
  state.finalized = false;
  state.queries = [];
}
const save = (change) =>
  exams.saveAnswer("owner", "access", "workstation", {
    questionId: "question",
    answer: ["A"],
    review: false,
    expectedRevision: 0,
    ...change,
  });
test("mocked answer persistence: retries are idempotent and stale conflicting changes are rejected", async () => {
  setup();
  assert.equal((await save()).revision, 1);
  assert.equal((await save()).revision, 1);
  await assert.rejects(save({ answer: ["B"] }), (e) => e.status === 409);
  assert.deepEqual(state.answer.answer, ["A"]);
  assert.equal(
    (await save({ answer: ["B"], expectedRevision: 1 })).revision,
    2,
  );
});
test("mocked attempt ownership and revoked authorization reject answer access", async () => {
  setup();
  await assert.rejects(
    exams.getAttempt("other-user", "access", "workstation"),
    (e) => e.status === 401,
  );
  state.row.user_status = "disabled";
  await assert.rejects(save(), (e) => e.status === 403);
  assert.equal(state.answer, null);
});
test("mocked expiry commits finalization and rejects late answer edits", async () => {
  setup();
  await save();
  state.attempt.deadline = "2000-01-01 00:00:00";
  const r = await save({ answer: ["B"], expectedRevision: 1 });
  assert.equal(r.submitted, true);
  assert.equal(state.finalized, true);
  assert.deepEqual(state.answer.answer, ["A"]);
});
test("mocked submission is repeatable and later answer edits remain locked", async () => {
  setup();
  await save();
  assert.equal(
    (await exams.submitAttempt("owner", "access", "workstation")).submitted,
    true,
  );
  assert.equal(
    (await exams.submitAttempt("owner", "access", "workstation")).submitted,
    true,
  );
  assert.equal(
    (await save({ answer: ["B"], expectedRevision: 1 })).submitted,
    true,
  );
  assert.deepEqual(state.answer.answer, ["A"]);
});
test("mocked candidate question delivery uses explicit safe columns and never fetches grading keys", async () => {
  setup();
  const data = await exams.getAttempt("owner", "access", "workstation");
  assert.equal(data.questions[0].options[0].id, "A");
  assert.ok(
    state.queries.some((q) =>
      q.startsWith("SELECT id,type,prompt,marks,negative_marks,position"),
    ),
  );
  assert.ok(!state.queries.some((q) => q.includes("answer_keys")));
  assert.ok(!JSON.stringify(data).includes("correct_answer"));
});
