import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { query, transaction } from "../config/database.js";
import { otp, digest, equal, dateSql, nowMs, fail } from "../utils/security.js";
import { sendMail, enqueue, smtp } from "./communications.js";
import { rateLimit } from "../middleware/security.js";
export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: u.status,
  emailVerified: !!u.email_verified_at,
});
export async function signup(data) {
  const hash = await bcrypt.hash(data.password, 12);
  const userId = randomUUID();
  await transaction(async (c) => {
    if (data.examId) {
      const [exam] = await query(
        "SELECT id FROM examinations WHERE id=? AND status='open' AND UTC_TIMESTAMP(3) BETWEEN registration_start AND registration_end",
        [data.examId],
        c,
      );
      if (!exam) fail(409, "This examination is not accepting registrations.");
    }
    await query(
      "INSERT INTO users(id,name,email,phone,password_hash) VALUES(?,?,?,?,?)",
      [userId, data.name, data.email, data.phone, hash],
      c,
    );
    await query(
      "INSERT INTO students(user_id,dob,address,selected_exam_id) VALUES(?,?,?,?)",
      [userId, data.dob, data.address, data.examId || null],
      c,
    );
  });
  return userId;
}
export async function login(identity, password, requiredRole) {
  const [user] = await query("SELECT * FROM users WHERE email=? OR phone=?", [
    identity.toLowerCase(),
    identity,
  ]);
  // Use a real bcrypt comparison for unknown identities to reduce timing differences.
  const fallback =
    "$2b$12$9AkRfyYo8.RfiViTdXOnxOdRRvZ8SNUS66rw/dcXXRQMLtURNCf5e";
  const valid = await bcrypt.compare(password, user?.password_hash || fallback);
  if (
    !user ||
    !valid ||
    (requiredRole && user.role !== requiredRole) ||
    user.status !== "active" ||
    !user.email_verified_at
  )
    fail(401, "Invalid credentials or account is not active.");
  return user;
}
export async function sendVerification(userId, purpose) {
  if (!["email", "recovery"].includes(purpose))
    fail(400, "Only email verification is supported.");
  await rateLimit(`otp-send:${userId}:${purpose}`, 5, 3600);
  return transaction(async (c) => {
    const [user] = await query(
      "SELECT * FROM users WHERE id=? FOR UPDATE",
      [userId],
      c,
    );
    if (!user || user.status === "disabled")
      fail(400, "Account is unavailable.");
    if (purpose === "email" && user.email_verified_at)
      fail(409, "This contact is already verified.");
    const [old] = await query(
      "SELECT * FROM contact_verifications WHERE user_id=? AND purpose=?",
      [userId, purpose],
      c,
    );
    if (old && nowMs(old.sent_at) > Date.now() - 60000)
      fail(429, "Wait 60 seconds before requesting another code.");
    const value = otp();
    if (value)
      await sendMail(
        user.email,
        purpose === "recovery" ? "Password recovery" : "Verify your email",
        `Your six-digit code is ${value}. It expires in 10 minutes. Never share this code.`,
      );
    await query(
      "INSERT INTO contact_verifications(user_id,purpose,code_hash,provider_sid,expires_at,sent_at,attempts,consumed_at) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3),0,NULL) ON DUPLICATE KEY UPDATE code_hash=VALUES(code_hash),provider_sid=VALUES(provider_sid),expires_at=VALUES(expires_at),sent_at=VALUES(sent_at),attempts=0,consumed_at=NULL",
      [
        userId,
        purpose,
        value ? digest(`${userId}:${purpose}:${value}`) : null,
        null,
        dateSql(Date.now() + 600000),
      ],
      c,
    );
  });
}
// Return failed outcomes from the transaction so attempt increments are committed.
export async function consumeVerification(userId, purpose, code, after) {
  if (!["email", "recovery"].includes(purpose))
    fail(400, "Only email verification is supported.");
  await rateLimit(`otp-check:${userId}:${purpose}`, 10, 3600);
  const result = await transaction(async (c) => {
    const [user] = await query(
      "SELECT * FROM users WHERE id=? FOR UPDATE",
      [userId],
      c,
    );
    const [record] = await query(
      "SELECT * FROM contact_verifications WHERE user_id=? AND purpose=? FOR UPDATE",
      [userId, purpose],
      c,
    );
    if (
      !user ||
      user.status === "disabled" ||
      !record ||
      record.consumed_at ||
      nowMs(record.expires_at) <= Date.now() ||
      record.attempts >= 5
    )
      return false;
    await query(
      "UPDATE contact_verifications SET attempts=attempts+1 WHERE user_id=? AND purpose=?",
      [userId, purpose],
      c,
    );
    const valid = equal(
      record.code_hash,
      digest(`${userId}:${purpose}:${code}`),
    );
    if (!valid) return false;
    await query(
      "UPDATE contact_verifications SET consumed_at=UTC_TIMESTAMP(3),code_hash=NULL WHERE user_id=? AND purpose=?",
      [userId, purpose],
      c,
    );
    if (purpose !== "recovery") {
      await query(
        "UPDATE users SET email_verified_at=UTC_TIMESTAMP(3) WHERE id=?",
        [userId],
        c,
      );
      await query(
        "UPDATE users SET status='active' WHERE id=? AND email_verified_at IS NOT NULL AND status='pending'",
        [userId],
        c,
      );
    }
    if (after) await after(user, c);
    return true;
  });
  if (!result)
    fail(
      400,
      "The code is incorrect, expired, already used, or has reached its attempt limit.",
    );
}
export async function recover(email) {
  smtp();
  const [user] = await query(
    "SELECT id FROM users WHERE email=? AND status<>'disabled'",
    [email],
  );
  if (user) {
    try {
      await sendVerification(user.id, "recovery");
    } catch (error) {
      if (error.status === 503)
        throw error; /* Keep destination existence private; delivery is not claimed. */
    }
  }
}
export async function resetPassword(email, code, password) {
  const [user] = await query(
    "SELECT id FROM users WHERE email=? AND status<>'disabled'",
    [email],
  );
  if (!user) fail(400, "The code is incorrect, expired, or already used.");
  const hash = await bcrypt.hash(password, 12);
  await consumeVerification(user.id, "recovery", code, async (u, c) => {
    await query("UPDATE users SET password_hash=? WHERE id=?", [hash, u.id], c);
    if (u.role !== "candidate" && u.status === "pending")
      await query(
        "UPDATE users SET email_verified_at=UTC_TIMESTAMP(3),status='active' WHERE id=?",
        [u.id],
        c,
      );
    await query("DELETE FROM sessions WHERE user_id=?", [u.id], c);
    await enqueue(
      u.id,
      "Password changed",
      "Your account password was changed. All application sessions have been revoked.",
      c,
    );
  });
}
