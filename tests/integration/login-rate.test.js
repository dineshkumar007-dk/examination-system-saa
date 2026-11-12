import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import app from "../../app.js";
import { query, closeDatabase } from "../../backend/src/config/database.js";
import { digest } from "../../backend/src/utils/security.js";

test(
  "REAL MySQL + HTTP: repeated valid sign-ins stay available; failed passwords remain limited",
  { skip: process.env.INTEGRATION_TESTS !== "true" },
  async () => {
    assert.match(process.env.DB_NAME, /^exampro_upgrade_[a-f0-9]{8}_test$/);
    process.env.APP_URL = "http://localhost:3000";
    const id = randomUUID(),
      email = `${id}@example.invalid`,
      password = "isolated-login-password";
    try {
      await query(
        "INSERT INTO users(id,name,email,password_hash,role,status,email_verified_at) VALUES(?,'Login test',?,?,'candidate','active',UTC_TIMESTAMP(3))",
        [id, email, await bcrypt.hash(password, 4)],
      );
      const agent = request.agent(app);
      const csrf = await agent.get("/api/csrf").expect(200);
      const signIn = (value, route = "/api/auth/login") =>
        agent
          .post(route)
          .set("Origin", process.env.APP_URL)
          .set("X-CSRF-Token", csrf.body.token)
          .send({ identity: email, password: value });
      for (let i = 0; i < 12; i++) await signIn(password).expect(200);
      for (let i = 0; i < 10; i++)
        await signIn("incorrect-password").expect(401);
      const limited = await signIn(password, "/api/auth/admin-login").expect(
        429,
      );
      const delay = Number(limited.headers["retry-after"]);
      assert.ok(delay > 800 && delay <= 900);
      assert.equal(limited.body.retryAfter, delay);
      await query(
        "UPDATE rate_limits SET resets_at='2000-01-01' WHERE bucket_key=?",
        [digest(`rate:login-v2:identity:${email}`)],
      );
      await signIn(password).expect(200);
      const remaining = await query(
        "SELECT hits FROM rate_limits WHERE bucket_key=?",
        [digest(`rate:login-v2:identity:${email}`)],
      );
      assert.equal(remaining.length, 0);
    } finally {
      await query("DELETE FROM sessions WHERE user_id=?", [id]);
      await query("DELETE FROM rate_limits WHERE bucket_key=?", [
        digest(`rate:login-v2:identity:${email}`),
      ]);
      await query("DELETE FROM users WHERE id=?", [id]);
      await closeDatabase();
    }
  },
);
