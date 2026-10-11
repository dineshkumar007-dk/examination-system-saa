import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  signup,
  questionInput,
  password,
  staffCreate,
} from "../backend/src/utils/validation.js";
import {
  digest,
  equal,
  seal,
  unseal,
  dateSql,
} from "../backend/src/utils/security.js";
import {
  gateExam,
  grade,
  validateAnswer,
} from "../backend/src/services/exams.js";
import {
  roles,
  active,
  centerScope,
} from "../backend/src/middleware/security.js";
process.env.APP_SECRET = "a".repeat(64);
process.env.DATA_ENCRYPTION_KEY = "b".repeat(64);
const user = {
  name: "A Candidate",
  email: "personal@example.com",
  phone: "+919876543210",
  dob: "2000-01-01",
  address: "A valid postal address",
  password: "long-unique-password",
  confirmPassword: "long-unique-password",
};
test("registration accepts personal email and rejects role escalation, invalid phone, mismatched passwords and future DOB", () => {
  assert.equal(signup.parse(user).email, user.email);
  for (const change of [
    { role: "admin" },
    { phone: "9876543210" },
    { confirmPassword: "wrong" },
    { dob: "2999-01-01" },
  ])
    assert.equal(signup.safeParse({ ...user, ...change }).success, false);
});
test("password validates bcrypt byte limit for multibyte input", () => {
  assert.equal(password.safeParse("密".repeat(30)).success, false);
  assert.equal(password.safeParse("a".repeat(12)).success, true);
});
test("staff creation requires matching strong passwords and a center for invigilators", () => {
  const data = {
    name: "Invigilator",
    email: "staff@example.com",
    role: "invigilator",
    centerId: randomUUID(),
    password: "staff-long-password",
    confirmPassword: "staff-long-password",
  };
  assert.ok(staffCreate.safeParse(data).success);
  for (const change of [
    { password: undefined },
    { password: "short", confirmPassword: "short" },
    { confirmPassword: "different" },
    { role: "admin" },
    { centerId: null },
  ])
    assert.equal(staffCreate.safeParse({ ...data, ...change }).success, false);
});
test("security digests and authenticated encryption reject tampering", () => {
  assert.ok(equal(digest("secret"), digest("secret")));
  assert.ok(!equal("short", "longer"));
  const sealed = seal({ secret: "private" });
  assert.deepEqual(unseal(sealed), { secret: "private" });
  const raw = Buffer.from(sealed, "base64");
  raw[20] ^= 1;
  assert.throws(() => unseal(raw.toString("base64")));
});
test("candidate role cannot access administrator or examiner APIs", () => {
  let error;
  roles("admin", "examiner")({ user: { role: "candidate" } }, {}, (e) => {
    error = e;
  });
  assert.equal(error.status, 403);
});
test("unverified and disabled users fail active account checks", () => {
  for (const status of ["pending", "disabled"]) {
    let error;
    active(
      {
        user: {
          status,
          role: "candidate",
          email_verified_at: null,
          phone_verified_at: null,
        },
      },
      {},
      (e) => {
        error = e;
      },
    );
    assert.equal(error.status, 403);
  }
});
test("email-verified candidates pass active checks without phone verification", () => {
  let outcome;
  active(
    {
      user: {
        status: "active",
        role: "candidate",
        email_verified_at: "yes",
        phone_verified_at: null,
      },
    },
    {},
    (error) => {
      outcome = error || "allowed";
    },
  );
  assert.equal(outcome, "allowed");
  active(
    {
      user: {
        status: "active",
        role: "candidate",
        email_verified_at: null,
        phone_verified_at: "yes",
      },
    },
    {},
    (error) => {
      outcome = error;
    },
  );
  assert.equal(outcome.status, 403);
});
test("invigilators are restricted to their assigned center", () => {
  assert.throws(() =>
    centerScope({ role: "invigilator", center_id: "one" }, "two"),
  );
  assert.doesNotThrow(() => centerScope({ role: "admin" }, "two"));
});
const now = Date.now();
const gate = {
  registration_status: "completed",
  user_status: "active",
  email_verified_at: "yes",
  phone_verified_at: null,
  exam_status: "active",
  center_active: 1,
  computer_active: 1,
  verified_at: "yes",
  attendance: "Verified",
  computer_id: "pc1",
  slot_id: "slot1",
  starts_at: dateSql(now - 1000),
  ends_at: dateSql(now + 60000),
};
const ws = {
  computer_id: "pc1",
  slot_id: "slot1",
  expires_at: dateSql(now + 60000),
};
test("exam gate validates every eligibility and workstation condition", () => {
  assert.equal(gateExam(gate, ws, now), true);
  for (const change of [
    { registration_status: "payment_pending" },
    { user_status: "disabled" },
    { email_verified_at: null },

    { exam_status: "closed" },
    { center_active: 0 },
    { computer_active: 0 },
    { verified_at: null },
    { attendance: "Absent" },
    { computer_id: "pc2" },
    { slot_id: "slot2" },
    { starts_at: dateSql(now + 10000) },
    { ends_at: dateSql(now - 1000) },
  ])
    assert.equal(gateExam({ ...gate, ...change }, ws, now), false);
  assert.equal(
    gateExam(gate, { ...ws, expires_at: dateSql(now - 1000) }, now),
    false,
  );
  assert.equal(gateExam(gate, null, now), false);
});
test("candidate response validation enforces MCQ/MSQ/NAT types and rejects unknown options", () => {
  validateAnswer({ type: "MCQ" }, ["A", "B"], ["A"]);
  validateAnswer({ type: "MSQ" }, ["A", "B"], ["A", "B"]);
  validateAnswer({ type: "NAT" }, [], 2.5);
  for (const [type, a] of [
    ["MCQ", ["A", "B"]],
    ["MSQ", ["A", "A"]],
    ["MCQ", ["Z"]],
    ["NAT", Infinity],
    ["NAT", "2"],
  ])
    assert.throws(() => validateAnswer({ type }, ["A", "B"], a));
});
test("grading handles multiple choice exact sets, tolerance, negative marks, and blanks", () => {
  const q = {
    type: "MSQ",
    correct_answer: ["A", "C"],
    marks: 2,
    negative_marks: 0.5,
  };
  assert.equal(grade(q, ["C", "A"]), 2);
  assert.equal(grade(q, ["A"]), -0.5);
  assert.equal(grade(q, null), 0);
  assert.equal(
    grade(
      {
        type: "NAT",
        correct_answer: 2,
        tolerance: 0.01,
        marks: 1,
        negative_marks: 0,
      },
      2.005,
    ),
    1,
  );
});
test("question authoring rejects invalid keys and duplicate option IDs", () => {
  const q = {
    examId: randomUUID(),
    type: "MCQ",
    prompt: "What is correct?",
    options: [
      { id: "A", text: "First" },
      { id: "B", text: "Second" },
    ],
    correctAnswer: ["A"],
    marks: 1,
    negativeMarks: 0,
    position: 1,
  };
  assert.ok(questionInput.safeParse(q).success);
  assert.ok(!questionInput.safeParse({ ...q, correctAnswer: ["Z"] }).success);
  assert.ok(
    !questionInput.safeParse({
      ...q,
      options: [
        { id: "A", text: "one" },
        { id: "A", text: "two" },
      ],
    }).success,
  );
});
