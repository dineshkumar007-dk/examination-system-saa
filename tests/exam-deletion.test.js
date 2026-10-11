import { test, mock } from "node:test";
import assert from "node:assert/strict";
const state = { record: { status: "open" }, live: 0, queries: [] };
mock.module("../backend/src/config/database.js", {
  namedExports: {
    transaction: async (fn) => fn({}),
    query: async (sql) => {
      state.queries.push(sql);
      if (sql.startsWith("SELECT *")) return state.record ? [state.record] : [];
      if (sql.startsWith("SELECT COUNT")) return [{ live: state.live }];
      return {};
    },
  },
});
const { deleteExamination, deleteSlot } = await import(
  "../backend/src/services/administration.js"
);
test("exam and slot deletion revokes device access while retaining student records", async () => {
  for (const action of [deleteExamination, deleteSlot]) {
    state.record = { status: "active" };
    state.live = 0;
    state.queries = [];
    await action("admin", "id");
    assert.ok(
      state.queries.some((sql) => sql.includes("deleted_at=UTC_TIMESTAMP")),
    );
    assert.ok(
      state.queries.some(
        (sql) =>
          sql.startsWith("DELETE") && sql.includes("workstation_sessions"),
      ),
    );
    assert.ok(
      state.queries.every(
        (sql) =>
          !/^DELETE FROM (registrations|exam_attempts|student_answers|results)/.test(
            sql,
          ),
      ),
    );
    assert.ok(state.queries.at(-1).startsWith("INSERT INTO audit_logs"));
  }
});
test("deletion blocks live attempts and rejects missing or already removed records", async () => {
  for (const action of [deleteExamination, deleteSlot]) {
    state.record = {};
    state.live = 1;
    state.queries = [];
    await assert.rejects(
      action("admin", "id"),
      (error) => error.status === 409,
    );
    assert.ok(state.queries.every((sql) => sql.startsWith("SELECT")));
    for (const record of [null, { deleted_at: "yes" }]) {
      state.record = record;
      state.live = 0;
      await assert.rejects(
        action("admin", "id"),
        (error) => error.status === 404,
      );
    }
  }
});
