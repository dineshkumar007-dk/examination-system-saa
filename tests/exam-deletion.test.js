import { test, mock } from "node:test";
import assert from "node:assert/strict";
const state = { exam: null, registrations: 0, queries: [] };
mock.module("../backend/src/config/database.js", {
  namedExports: {
    transaction: async (fn) => fn({}),
    query: async (sql) => {
      state.queries.push(sql);
      if (sql.startsWith("SELECT * FROM examinations"))
        return state.exam ? [state.exam] : [];
      if (sql.startsWith("SELECT COUNT(*)"))
        return [{ n: state.registrations }];
      return {};
    },
  },
});
const { deleteExamination } = await import(
  "../backend/src/services/administration.js"
);
function setup(status, registrations = 0) {
  state.exam = status ? { status } : null;
  state.registrations = registrations;
  state.queries = [];
}
test("unused draft, open and closed exams delete their dependent records in one transaction", async () => {
  for (const status of ["draft", "open", "closed"]) {
    setup(status);
    await deleteExamination("admin", "exam");
    assert.ok(
      state.queries.some((sql) =>
        sql.startsWith("DELETE w FROM workstation_sessions"),
      ),
    );
    assert.ok(
      state.queries.some((sql) => sql.startsWith("DELETE FROM questions")),
    );
    const deleted = state.queries.indexOf(
      "DELETE FROM examinations WHERE id=?",
    );
    assert.ok(
      deleted > state.queries.indexOf("DELETE FROM exam_slots WHERE exam_id=?"),
    );
    assert.ok(state.queries.at(-1).startsWith("INSERT INTO audit_logs"));
  }
});
test("registered, active and completed exams reject deletion before any mutation", async () => {
  for (const [status, registrations] of [
    ["open", 1],
    ["closed", 1],
    ["active", 0],
    ["completed", 0],
  ]) {
    setup(status, registrations);
    await assert.rejects(
      deleteExamination("admin", "exam"),
      (error) => error.status === 409,
    );
    assert.ok(state.queries.every((sql) => sql.startsWith("SELECT")));
  }
  setup(null);
  await assert.rejects(
    deleteExamination("admin", "missing"),
    (error) => error.status === 404,
  );
});
