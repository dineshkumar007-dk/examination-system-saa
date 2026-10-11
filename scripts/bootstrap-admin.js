import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import { required } from "../backend/src/config/env.js";
import { email, password } from "../backend/src/utils/validation.js";
import {
  transaction,
  query,
  closeDatabase,
} from "../backend/src/config/database.js";
try {
  const address = email.parse(required("ADMIN_EMAIL")),
    secret = password.parse(required("ADMIN_PASSWORD"));
  const hash = await bcrypt.hash(secret, 12);
  await transaction(async (c) => {
    const existing = await query(
      "SELECT id FROM users WHERE role='admin' FOR UPDATE",
      [],
      c,
    );
    if (existing.length)
      throw new Error(
        "An administrator already exists; bootstrap refuses to create another.",
      );
    await query(
      "INSERT INTO users(id,name,email,password_hash,role,status,email_verified_at) VALUES(?,'Examination Administrator',?,?,'admin','active',UTC_TIMESTAMP(3))",
      [randomUUID(), address, hash],
      c,
    );
  });
  console.log(
    "Administrator provisioned. Remove ADMIN_PASSWORD from the environment.",
  );
} finally {
  await closeDatabase();
}
