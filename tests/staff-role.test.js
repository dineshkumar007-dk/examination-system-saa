import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { staffCreate } from "../backend/src/utils/validation.js";
test("staff creation supports invigilators and rejects retired examiner role", () => {
  const staff = {
    name: "Center staff",
    email: "staff@example.com",
    centerId: randomUUID(),
    password: "valid-long-password",
    confirmPassword: "valid-long-password",
  };
  assert.equal(
    staffCreate.safeParse({ ...staff, role: "invigilator" }).success,
    true,
  );
  assert.equal(
    staffCreate.safeParse({ ...staff, role: "examiner" }).success,
    false,
  );
});
