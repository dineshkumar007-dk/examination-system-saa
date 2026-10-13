import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { signup as schema } from "../backend/src/utils/validation.js";
const writes = [];
mock.module("../backend/src/config/database.js", {
  namedExports: {
    query: async (sql, params) => {
      writes.push({ sql, params });
      return {};
    },
    transaction: async (fn) => fn({}),
  },
});
const { signup, publicUser } = await import("../backend/src/services/auth.js");
const candidate = {
  name: "Profile Test",
  email: "profile@example.com",
  phone: "+919876543210",
  dob: "2000-01-01",
  address: "A valid postal address",
  password: "unique-long-password",
  confirmPassword: "unique-long-password",
  gender: "female",
};
test("registration requires an explicit male or female choice", () => {
  for (const gender of ["male", "female"])
    assert.equal(schema.parse({ ...candidate, gender }).gender, gender);
  for (const gender of [undefined, "", "other", "Female"])
    assert.equal(schema.safeParse({ ...candidate, gender }).success, false);
});
test("registration persists chosen gender and exposes it without credentials", async () => {
  writes.length = 0;
  const id = await signup(schema.parse(candidate));
  const user = writes.find((w) => w.sql.startsWith("INSERT INTO users"));
  assert.match(user.sql, /password_hash,gender/);
  assert.equal(user.params[5], "female");
  assert.notEqual(user.params[4], candidate.password);
  assert.equal(user.params[0], id);
  const profile = publicUser({
    ...candidate,
    id,
    role: "candidate",
    status: "active",
    password_hash: user.params[4],
  });
  assert.equal(profile.gender, "female");
  assert.equal(profile.password, undefined);
  assert.equal(profile.password_hash, undefined);
  assert.equal(publicUser({ name: "Existing account" }).gender, null);
});
