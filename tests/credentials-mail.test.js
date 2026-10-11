import { test, mock } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
process.env.APP_URL = "http://localhost:3000";
process.env.APP_SECRET = "a".repeat(64);
const state = { attempt: false, hash: null, mail: null, mutations: 0 };
mock.module("../backend/src/config/database.js", {
  namedExports: {
    transaction: async (fn) => fn({}),
    query: async (sql, args) => {
      if (sql.startsWith("SELECT id FROM exam_attempts"))
        return state.attempt ? [{ id: "attempt" }] : [];
      state.mutations++;
      if (sql.startsWith("UPDATE hall_tickets")) state.hash = args[0];
      return {};
    },
  },
});
mock.module("../backend/src/services/communications.js", {
  namedExports: {
    enqueue: async (user, event, text, connection, credentials) => {
      state.mail = { user, event, text, credentials };
      return "notification";
    },
  },
});
const { issueActivation } = await import(
  "../backend/src/services/administration.js"
);
test("issued email contains matching registration, hall ticket and a randomly generated hashed exam password", async () => {
  state.attempt = false;
  assert.equal(
    await issueActivation("allocation", "candidate", "EXP-123", "HT-123", {}),
    "notification",
  );
  assert.match(state.mail.text, /Registration ID: EXP-123/);
  assert.match(state.mail.text, /Hall ticket number: HT-123/);
  const password = state.mail.text.match(
    /Examination password: ([a-f0-9]{24})/,
  )[1];
  assert.ok(await bcrypt.compare(password, state.hash));
  assert.notEqual(state.hash, password);
  assert.equal(state.mail.credentials.examPasswordHash, state.hash);
  await issueActivation("allocation", "candidate", "EXP-123", "HT-123", {});
  assert.ok(!(await bcrypt.compare(password, state.hash)));
});
test("examination credentials cannot be reissued after an attempt starts", async () => {
  state.attempt = true;
  state.mutations = 0;
  await assert.rejects(
    issueActivation("allocation", "candidate", "EXP-123", "HT-123", {}),
    (error) => error.status === 409,
  );
  assert.equal(state.mutations, 0);
});
