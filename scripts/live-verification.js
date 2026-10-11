// Explicit opt-in real provider test. Creates a real pending candidate account.
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  signup,
  sendVerification,
  consumeVerification,
  login,
} from "../backend/src/services/auth.js";
import { signup as schema } from "../backend/src/utils/validation.js";
import { required } from "../backend/src/config/env.js";
import { token } from "../backend/src/utils/security.js";
import { query, closeDatabase } from "../backend/src/config/database.js";
if (process.env.LIVE_TEST_CONFIRM !== "yes")
  throw new Error(
    "Set LIVE_TEST_CONFIRM=yes and LIVE_TEST_EMAIL/PHONE to destinations you own. This test creates a real account and incurs provider charges.",
  );
const input = createInterface({ input: stdin, output: stdout });
try {
  const secret = token();
  const d = schema.parse({
    name: "Provider integration test",
    email: required("LIVE_TEST_EMAIL"),
    phone: required("LIVE_TEST_PHONE"),
    dob: "2000-01-01",
    address: "Provider integration test account",
    password: secret,
    confirmPassword: secret,
  });
  const userId = await signup(d);
  await sendVerification(userId, "email");
  await consumeVerification(
    userId,
    "email",
    (
      await input.question(
        "Enter the real email code (not logged by the application): ",
      )
    ).trim(),
  );
  await login(d.email, secret);
  await query("DELETE FROM sessions WHERE user_id=?", [userId]);
  console.log(
    "Real email verification plus persisted account login succeeded. Use Forgot password to access this test account later.",
  );
} finally {
  input.close();
  await closeDatabase();
}
