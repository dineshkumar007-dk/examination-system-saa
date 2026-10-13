import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../app.js";
process.env.APP_URL = "http://localhost:3000";
process.env.APP_SECRET = "c".repeat(64);
test("public pages and Bootstrap assets serve with security headers", async () => {
  for (const path of [
    "/",
    "/login",
    "/invigilator-login",
    "/admin-login",
    "/signup",
    "/exam",
    "/assets/bootstrap/css/bootstrap.min.css",
  ]) {
    const r = await request(app).get(path);
    assert.equal(r.status, 200);
    assert.ok(r.headers["x-content-type-options"]);
    if (!path.startsWith("/assets/"))
      assert.equal(r.headers["cache-control"], "no-store");
  }
  const r = await request(app).get("/");
  assert.match(r.headers["content-security-policy"], /frame-ancestors 'none'/);
});
test("private APIs require server-side authentication", async () => {
  for (const path of [
    "/api/me",
    "/api/profile",
    "/api/manage/users",
    "/api/manage/questions",
    "/api/registrations/mine",
    "/api/exam/attempt",
  ]) {
    const r = await request(app).get(path);
    assert.equal(r.status, 401);
    assert.ok(!JSON.stringify(r.body).includes("password_hash"));
  }
});
test("cross-origin and missing CSRF requests fail before any data mutation", async () => {
  let r = await request(app)
    .post("/api/auth/signup")
    .set("Origin", "https://evil.example")
    .send({});
  assert.equal(r.status, 403);
  r = await request(app)
    .post("/api/auth/signup")
    .set("Origin", process.env.APP_URL)
    .send({});
  assert.equal(r.status, 403);
});
test("CSRF cookies are HttpOnly and SameSite Strict, and signed tokens are required", async () => {
  const agent = request.agent(app);
  const issue = await agent.get("/api/csrf");
  assert.match(issue.headers["set-cookie"][0], /HttpOnly/);
  assert.match(issue.headers["set-cookie"][0], /SameSite=Strict/);
  const r = await agent
    .post("/api/auth/logout")
    .set("Origin", process.env.APP_URL)
    .set("X-CSRF-Token", issue.body.token)
    .send({});
  assert.equal(r.status, 401);
  const bad = await agent
    .post("/api/auth/logout")
    .set("Origin", process.env.APP_URL)
    .set("X-CSRF-Token", "tampered")
    .send({});
  assert.equal(bad.status, 403);
});
test("oversized requests and unknown endpoints return safe errors", async () => {
  const r = await request(app)
    .post("/api/auth/signup")
    .send({ name: "a".repeat(40000) });
  assert.equal(r.status, 413);
  const missing = await request(app).get("/nonexistent");
  assert.equal(missing.status, 404);
});
