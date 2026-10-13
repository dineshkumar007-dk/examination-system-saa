import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  issueAdminAccess,
  validAdminAccess,
} from "../backend/src/middleware/admin-access.js";
process.env.APP_SECRET = "a".repeat(64);
test("admin page proof requires fresh login and is bound to user and session", () => {
  const proof = issueAdminAccess("admin", "session-one");
  assert.ok(validAdminAccess(proof, "admin", "session-one"));
  for (const [value, user, session] of [
    [undefined, "admin", "session-one"],
    [proof, "another-admin", "session-one"],
    [proof, "admin", "session-two"],
    [proof.slice(0, -1) + "z", "admin", "session-one"],
  ])
    assert.equal(validAdminAccess(value, user, session), false);
});
mock.module("../backend/src/config/database.js", {
  namedExports: {
    query: async () => [{ id: "admin", role: "admin", status: "active" }],
    transaction: async (fn) => fn({}),
  },
});
const { authenticate } = await import("../backend/src/middleware/security.js");
test("shared admin cookie cannot authorize a new page without its session-bound proof", async () => {
  const run = async (proof) => {
    let result;
    await authenticate(
      { cookies: { ep_session: "cookie" }, get: () => proof },
      {},
      (error) => {
        result = error || "allowed";
      },
    );
    return result;
  };
  assert.equal((await run(undefined)).status, 401);
  assert.equal(
    (await run(issueAdminAccess("admin", "wrong-session"))).status,
    401,
  );
  assert.equal(await run(issueAdminAccess("admin", "cookie")), "allowed");
});
