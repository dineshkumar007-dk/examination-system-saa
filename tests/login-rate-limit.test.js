import { test, mock } from "node:test";
import assert from "node:assert/strict";
process.env.APP_SECRET = "r".repeat(64);
const buckets = new Map();
mock.module("../backend/src/config/database.js", {
  namedExports: {
    query: async (sql, args) => {
      if (sql.startsWith("INSERT INTO rate_limits")) {
        const hits = Math.min((buckets.get(args[0]) || 0) + 1, args[2]);
        buckets.set(args[0], hits);
        return { insertId: hits };
      }
      if (sql.startsWith("SELECT GREATEST")) return [{ retry_after: 735 }];
      if (sql.startsWith("DELETE FROM rate_limits")) {
        buckets.delete(args[0]);
        return {};
      }
      if (sql.startsWith("INSERT INTO sessions")) return {};
      throw Error("Unexpected query in login test: " + sql);
    },
    transaction: async (fn) => fn({}),
  },
});
mock.module("../backend/src/services/auth.js", {
  namedExports: {
    login: async (identity, password, role) => {
      if (password !== "correct-password")
        throw Object.assign(Error("Invalid credentials"), { status: 401 });
      return { id: identity, role, status: "active" };
    },
    publicUser: (user) => user,
  },
});
const { loginThrottle, throttle, errorHandler } = await import(
  "../backend/src/middleware/security.js"
);
const controllers = await import(
  "../backend/src/controllers/auth-controller.js"
);
const { digest } = await import("../backend/src/utils/security.js");
async function attempt(
  identity,
  password,
  ip = "test-center",
  role = "candidate",
) {
  const req = { ip, body: { identity, password }, cookies: {} };
  let error, response;
  const res = {
    cookie() {},
    json(value) {
      response = value;
    },
  };
  await loginThrottle(req, res, (e) => {
    error = e;
  });
  if (!error) {
    try {
      await controllers[
        {
          candidate: "logIn",
          admin: "adminLogIn",
          examiner: "examinerLogIn",
          invigilator: "invigilatorLogIn",
        }[role]
      ](req, res);
    } catch (e) {
      error = e;
    }
  }
  return { error, response };
}

test("successful fresh logins do not accumulate an account lockout in any role", async () => {
  buckets.clear();
  for (const role of ["candidate", "admin", "examiner", "invigilator"]) {
    for (let i = 0; i < 15; i++) {
      const result = await attempt(
        `${role}@example.invalid`,
        "correct-password",
        "test-center",
        role,
      );
      assert.equal(result.error, undefined);
      assert.equal(result.response.role, role);
    }
  }
});

test("different candidates sharing a center connection are not blocked after ten sign-ins", async () => {
  buckets.clear();
  for (let i = 0; i < 25; i++) {
    const result = await attempt(
      `candidate${i}@example.invalid`,
      "correct-password",
    );
    assert.equal(result.error, undefined);
  }
});

test("ten failed passwords block the account across IP addresses and role endpoints", async () => {
  buckets.clear();
  for (let i = 0; i < 10; i++) {
    const result = await attempt(" Locked@Example.invalid ", "incorrect");
    assert.equal(result.error.status, 401);
  }
  const blocked = await attempt(
    "locked@example.invalid",
    "correct-password",
    "another-ip",
    "admin",
  );
  assert.equal(blocked.error.status, 429);
  assert.equal(blocked.error.retryAfter, 735);
  const headers = {};
  let body;
  errorHandler(
    blocked.error,
    {},
    {
      set(k, v) {
        headers[k] = v;
      },
      status(code) {
        assert.equal(code, 429);
        return this;
      },
      json(value) {
        body = value;
      },
    },
    () => {},
  );
  assert.equal(headers["Retry-After"], "735");
  assert.equal(body.retryAfter, 735);
});

test("shared connection traffic remains limited without consuming new identity quotas", async () => {
  buckets.clear();
  buckets.set(digest("rate:login-v2:test-center"), 300);
  const result = await attempt("untouched@example.invalid", "correct-password");
  assert.equal(result.error.status, 429);
  assert.equal(
    buckets.has(digest("rate:login-v2:identity:untouched@example.invalid")),
    false,
  );
});

test("OTP and other throttles retain their original per-IP limits", async () => {
  buckets.clear();
  const limit = throttle("send-code-test", 2, 3600);
  let error;
  for (let i = 0; i < 3; i++)
    await limit({ ip: "otp-ip", body: {} }, {}, (e) => {
      error = e;
    });
  assert.equal(error.status, 429);
});
