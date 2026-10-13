// Isolated unit tests ONLY: database and delivery modules are replaced by Node's test loader.
// Production code has no mock provider switch, fixed OTP, or test account.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
process.env.APP_SECRET = "d".repeat(64);
const state = {
  user: null,
  verification: null,
  mail: null,
  sessionDeleted: false,
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
      if (
        sql.startsWith("SELECT * FROM users") ||
        sql.startsWith("SELECT id FROM users")
      )
        return state.user ? [structuredClone(state.user)] : [];
      if (sql.startsWith("SELECT * FROM contact_verifications"))
        return state.verification ? [structuredClone(state.verification)] : [];
      if (sql.startsWith("INSERT INTO contact_verifications")) {
        state.verification = {
          code_hash: args[2],
          provider_sid: args[3],
          expires_at: args[4],
          sent_at: new Date().toISOString(),
          attempts: 0,
          consumed_at: null,
        };
        return {};
      }
      if (sql.includes("SET attempts=attempts+1")) {
        state.verification.attempts++;
        return {};
      }
      if (sql.includes("SET consumed_at=")) {
        state.verification.consumed_at = "used";
        state.verification.code_hash = null;
        return {};
      }
      if (sql.includes("SET email_verified_at=")) {
        state.user.email_verified_at = "verified";
        return {};
      }
      if (sql.includes("SET status='active'")) {
        if (state.user.email_verified_at) state.user.status = "active";
        return {};
      }
      if (sql.includes("SET password_hash=")) {
        state.user.password_hash = args[0];
        return {};
      }
      if (sql.startsWith("DELETE FROM sessions")) {
        state.sessionDeleted = true;
        return {};
      }
      throw new Error("Unhandled isolated test query: " + sql);
    },
  },
});
mock.module("../backend/src/middleware/security.js", {
  namedExports: { rateLimit: async () => {} },
});
let rejectMail = false;
mock.module("../backend/src/services/communications.js", {
  namedExports: {
    smtp: () => ({}),
    sendMail: async (to, subject, text) => {
      if (rejectMail) throw new Error("Provider unavailable");
      state.mail = text;
    },
    enqueue: async () => {},
  },
});
const auth = await import("../backend/src/services/auth.js");
const setup = async () => {
  state.user = {
    id: "unit-test-user",
    email: "unit@example.com",
    phone: "+919876543210",
    password_hash: await bcrypt.hash("valid-long-password", 4),
    role: "candidate",
    status: "pending",
    email_verified_at: null,
    phone_verified_at: null,
  };
  state.verification = null;
  state.mail = null;
  state.sessionDeleted = false;
  rejectMail = false;
};
test("mocked email OTP: wrong attempt persists, correct verification is single-use", async () => {
  await setup();
  await auth.sendVerification(state.user.id, "email");
  const code = state.mail.match(/\b\d{6}\b/)[0];
  assert.ok(!state.verification.code_hash.includes(code));
  const wrong = code === "999999" ? "111111" : "999999";
  await assert.rejects(auth.consumeVerification(state.user.id, "email", wrong));
  assert.equal(state.verification.attempts, 1);
  await auth.consumeVerification(state.user.id, "email", code);
  assert.ok(state.user.email_verified_at);
  assert.equal(state.user.status, "active");
  await assert.rejects(auth.consumeVerification(state.user.id, "email", code));
});
test("mocked OTP expiry and maximum attempts reject even correct code", async () => {
  await setup();
  await auth.sendVerification(state.user.id, "email");
  const code = state.mail.match(/\b\d{6}\b/)[0];
  state.verification.expires_at = "2000-01-01 00:00:00";
  await assert.rejects(auth.consumeVerification(state.user.id, "email", code));
  state.verification.expires_at = "2999-01-01 00:00:00";
  state.verification.attempts = 5;
  await assert.rejects(auth.consumeVerification(state.user.id, "email", code));
});
test("mocked resend cooldown and delivery failure never record success", async () => {
  await setup();
  await auth.sendVerification(state.user.id, "email");
  await assert.rejects(
    auth.sendVerification(state.user.id, "email"),
    (e) => e.status === 429,
  );
  await setup();
  rejectMail = true;
  await assert.rejects(auth.sendVerification(state.user.id, "email"));
  assert.equal(state.verification, null);
});
test("removed SMS channel is rejected without recording verification", async () => {
  await setup();
  await assert.rejects(
    auth.sendVerification(state.user.id, "sms"),
    (e) => e.status === 400,
  );
  await assert.rejects(
    auth.consumeVerification(state.user.id, "sms", "123456"),
    (e) => e.status === 400,
  );
  assert.equal(state.verification, null);
  assert.equal(state.user.status, "pending");
});
test("mocked persisted login rejects unknown, incorrect password, pending and disabled accounts", async () => {
  await setup();
  await assert.rejects(auth.login("unit@example.com", "valid-long-password"));
  state.user.status = "active";
  state.user.email_verified_at = "yes";
  assert.equal(state.user.phone_verified_at, null);
  await assert.rejects(auth.login("unit@example.com", "wrong-password"));
  assert.equal(
    (await auth.login("unit@example.com", "valid-long-password")).id,
    state.user.id,
  );
  state.user.status = "disabled";
  await assert.rejects(auth.login("unit@example.com", "valid-long-password"));
  state.user = null;
  await assert.rejects(
    auth.login("unknown@example.com", "valid-long-password"),
  );
});
test("mocked recovery consumes code and invalidates account sessions", async () => {
  await setup();
  await auth.sendVerification(state.user.id, "recovery");
  const code = state.mail.match(/\b\d{6}\b/)[0];
  await auth.resetPassword(state.user.email, code, "new-long-password");
  assert.ok(
    await bcrypt.compare("new-long-password", state.user.password_hash),
  );
  assert.equal(state.sessionDeleted, true);
  await assert.rejects(
    auth.resetPassword(state.user.email, code, "another-password"),
  );
});
test("selected login roles reject wrong-role credentials and retired examiners", async () => {
  await setup();
  state.user.status = "active";
  state.user.email_verified_at = "yes";
  state.user.role = "admin";
  await assert.rejects(
    auth.login(state.user.email, "valid-long-password", "candidate"),
    (e) => e.status === 401,
  );
  state.user.role = "candidate";
  await assert.rejects(
    auth.login(state.user.email, "valid-long-password", "admin"),
    (e) => e.status === 401,
  );
  state.user.role = "examiner";
  await assert.rejects(
    auth.login(state.user.email, "valid-long-password"),
    (e) => e.status === 401,
  );
});

test("invigilator sign-in rejects candidate and admin credentials and accepts active invigilators", async () => {
  await setup();
  state.user.status = "active";
  state.user.email_verified_at = "yes";
  for (const role of ["candidate", "admin", "examiner"]) {
    state.user.role = role;
    await assert.rejects(
      auth.login(state.user.email, "valid-long-password", "invigilator"),
      (error) => error.status === 401,
    );
  }
  state.user.role = "invigilator";
  assert.equal(
    (await auth.login(state.user.email, "valid-long-password", "invigilator"))
      .role,
    "invigilator",
  );
  state.user.status = "disabled";
  await assert.rejects(
    auth.login(state.user.email, "valid-long-password", "invigilator"),
  );
});
