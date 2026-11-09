// Local browser QA only. Refuses production and uses an ignored credential file.
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import bcrypt from "bcrypt";
import { query, closeDatabase } from "../backend/src/config/database.js";
import { dateSql } from "../backend/src/utils/security.js";
import { powerpointFixture } from "../tests/helpers/powerpoint-fixture.js";
if (!/^exampro_upgrade_[a-f0-9]{8}_test$/.test(process.env.DB_NAME || ""))
  throw Error("Only the isolated upgrade database is allowed.");
try {
  if (process.argv.includes("--clean")) {
    const f = JSON.parse(
      await readFile("test-results/upgrade-ui.json", "utf8"),
    );
    if (f.database !== process.env.DB_NAME)
      throw Error("Fixture database mismatch");
    await query("DELETE FROM question_papers WHERE exam_id=?", [f.examId]);
    await query("DELETE FROM questions WHERE exam_id=?", [f.examId]);
    await query("DELETE FROM examiner_assignments WHERE exam_id=?", [f.examId]);
    await query("DELETE FROM examinations WHERE id=?", [f.examId]);
    for (const id of [f.adminId, f.examinerId]) {
      await query("DELETE FROM sessions WHERE user_id=?", [id]);
      await query("DELETE FROM audit_logs WHERE actor_id=?", [id]);
      await query("DELETE FROM users WHERE id=?", [id]);
    }
    console.log("Isolated browser fixtures removed.");
  } else {
    const adminId = randomUUID(),
      examinerId = randomUUID(),
      examId = randomUUID(),
      password = randomBytes(24).toString("hex"),
      hash = await bcrypt.hash(password, 4);
    for (const [id, role, name] of [
      [adminId, "admin", "UI Test Administrator"],
      [examinerId, "examiner", "UI Test Examiner"],
    ])
      await query(
        "INSERT INTO users(id,name,email,password_hash,role,status,email_verified_at) VALUES(?,?,?,?,?,'active',UTC_TIMESTAMP(3))",
        [id, name, id + "@example.invalid", hash, role],
      );
    await query(
      "INSERT INTO examinations(id,name,description,instructions,duration_minutes,registration_start,registration_end,fee,status) VALUES(?,'UI test: Computing','Isolated browser test','Read every question carefully.',10,?,?,0,'draft')",
      [examId, dateSql(Date.now() + 3600000), dateSql(Date.now() + 7200000)],
    );
    await query(
      "INSERT INTO examiner_assignments(exam_id,examiner_id,assigned_by) VALUES(?,?,?)",
      [examId, examinerId, adminId],
    );
    await mkdir("test-results", { recursive: true });
    await writeFile(
      "test-results/upgrade-ui.json",
      JSON.stringify({
        adminId,
        examinerId,
        examId,
        email: examinerId + "@example.invalid",
        password,
        database: process.env.DB_NAME,
      }),
    );
    await writeFile(
      "test-results/upgrade-ui.pptx",
      await powerpointFixture({ image: true }),
    );
    console.log(
      "Isolated browser fixtures prepared (no real accounts or email delivery).",
    );
  }
} finally {
  await closeDatabase();
}
