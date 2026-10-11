import { test, mock } from "node:test";
import assert from "node:assert/strict";
const state = { writes: [], attendance: "Verified" };
mock.module("../backend/src/config/database.js", {
  namedExports: {
    transaction: async (fn) => fn({}),
    query: async (sql, args) => {
      if (sql.startsWith("SELECT a.*"))
        return [
          {
            id: "allocation",
            center_id: "center",
            ends_at: "2999-01-01 00:00:00",
            attendance: state.attendance,
          },
        ];
      if (sql.startsWith("SELECT * FROM computers"))
        return [{ id: "pc", center_id: "center", active: 1 }];
      state.writes.push({ sql, args });
      return {};
    },
  },
});
const { verifyAndAssign } = await import(
  "../backend/src/services/administration.js"
);
test("verified candidates cannot silently revert to Present and lose their assigned computer", async () => {
  state.writes = [];
  await assert.rejects(
    verifyAndAssign(
      { id: "staff", role: "invigilator", center_id: "center" },
      "allocation",
      null,
      "Present",
    ),
    (error) => error.status === 409,
  );
  assert.equal(state.writes.length, 0);
  await verifyAndAssign(
    { id: "staff", role: "invigilator", center_id: "center" },
    "allocation",
    "pc",
    "Verified",
  );
  assert.ok(
    state.writes.some(
      (item) =>
        item.sql.includes("SET attendance='Verified'") &&
        item.args.includes("pc"),
    ),
  );
});
test("explicitly confirmed removal can revoke a previous verification", async () => {
  state.writes = [];
  await verifyAndAssign(
    { id: "staff", role: "invigilator", center_id: "center" },
    "allocation",
    null,
    "Absent",
    true,
  );
  assert.ok(state.writes.some((item) => item.sql.includes("computer_id=NULL")));
});
