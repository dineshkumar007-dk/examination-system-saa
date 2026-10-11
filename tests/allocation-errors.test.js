import { test, mock } from "node:test";
import assert from "node:assert/strict";
const state = { slot: null, reg: null, center: null, mutations: 0 };
mock.module("../backend/src/config/database.js", {
  namedExports: {
    transaction: async (fn) => fn({}),
    query: async (sql) => {
      if (sql.startsWith("SELECT s.*")) return state.slot ? [state.slot] : [];
      if (sql.startsWith("SELECT r.*")) return state.reg ? [state.reg] : [];
      if (sql.startsWith("SELECT active"))
        return state.center ? [state.center] : [];
      state.mutations++;
      throw new Error("Unexpected mutation after invalid allocation");
    },
  },
});
const { allocate } = await import("../backend/src/services/administration.js");
test("allocation errors explain the failing requirement without creating a hall ticket", async () => {
  const cases = [
    ["open", {}, {}, /Close examination registration first/],
    ["closed", {}, { active: 0 }, /center is inactive/],
    ["closed", { status: "payment_pending" }, {}, /Complete this registration/],
    ["closed", { email_verified_at: null }, {}, /verified email/],
    ["closed", { exam_id: "other" }, {}, /same examination/],
  ];
  for (const [status, reg, center, message] of cases) {
    state.slot = {
      exam_id: "exam",
      exam_status: status,
      starts_at: "2999-01-01 00:00:00",
    };
    state.reg = {
      exam_id: "exam",
      status: "completed",
      user_status: "active",
      email_verified_at: "yes",
      ...reg,
    };
    state.center = { active: 1, ...center };
    state.mutations = 0;
    await assert.rejects(
      allocate("admin", "reg", "slot"),
      (error) => error.status === 409 && message.test(error.message),
    );
    assert.equal(state.mutations, 0);
  }
});
