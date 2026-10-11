import { test, mock } from "node:test";
import assert from "node:assert/strict";
const state = { user: null, registrations: 0, queries: [] };
mock.module("../backend/src/config/database.js", {
  namedExports: {
    transaction: async (fn) => fn({}),
    query: async (sql) => {
      state.queries.push(sql);
      if (sql.startsWith("SELECT id,role"))
        return state.user ? [state.user] : [];
      if (sql.startsWith("SELECT COUNT")) return [{ n: state.registrations }];
      return {};
    },
  },
});
const { deleteUser } = await import(
  "../backend/src/services/administration.js"
);
test("unused users are removed from the database after revoking dependent access", async () => {
  for (const role of ["candidate", "invigilator", "examiner"]) {
    state.user = { role };
    state.registrations = 0;
    state.queries = [];
    const result = await deleteUser("admin", "user");
    assert.equal(result.retainedExamRecords, false);
    assert.ok(state.queries.includes("DELETE FROM users WHERE id=?"));
    assert.ok(state.queries.includes("DELETE FROM sessions WHERE user_id=?"));
    assert.ok(
      state.queries.includes(
        "UPDATE audit_logs SET actor_id=NULL WHERE actor_id=?",
      ),
    );
    assert.ok(state.queries.at(-1).startsWith("INSERT INTO audit_logs"));
  }
});
test("registered users release email and phone while preserving exam records", async () => {
  state.user = { role: "candidate" };
  state.registrations = 1;
  state.queries = [];
  const result = await deleteUser("admin", "user");
  assert.equal(result.retainedExamRecords, true);
  assert.ok(
    state.queries.some((sql) =>
      sql.includes("email=CONCAT('deleted-',id,'@deleted.invalid'),phone=NULL"),
    ),
  );
  assert.ok(
    state.queries.every(
      (sql) =>
        !/^DELETE FROM (users|registrations|exam_attempts|student_answers|results)/.test(
          sql,
        ),
    ),
  );
});
test("self, administrator and missing users cannot be deleted", async () => {
  state.user = { role: "candidate" };
  state.queries = [];
  await assert.rejects(
    deleteUser("self", "self"),
    (error) => error.status === 409,
  );
  assert.equal(state.queries.length, 0);
  for (const user of [{ role: "admin" }, null]) {
    state.user = user;
    state.queries = [];
    await assert.rejects(deleteUser("admin", "user"));
    assert.ok(state.queries.every((sql) => sql.startsWith("SELECT")));
  }
});
