import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { database, closeDatabase } from "../backend/src/config/database.js";
const connection = await database().getConnection();
try {
  const [[lock]] = await connection.query(
    "SELECT GET_LOCK('exampro_migrations',30) AS locked",
  );
  if (!lock.locked) throw new Error("Another migration is running.");
  await connection.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(200) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  for (const name of (await readdir("database/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile("database/migrations/" + name, "utf8"),
      checksum = createHash("sha256").update(sql).digest("hex");
    const [[old]] = await connection.execute(
      "SELECT checksum FROM schema_migrations WHERE name=?",
      [name],
    );
    if (old) {
      if (old.checksum !== checksum)
        throw new Error(
          `Previously applied migration ${name} changed. Add a new migration instead.`,
        );
      continue;
    }
    // MySQL DDL commits implicitly. A failed migration must be repaired before retrying.
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await connection.query(statement);
    await connection.execute(
      "INSERT INTO schema_migrations(name,checksum) VALUES(?,?)",
      [name, checksum],
    );
    console.log(`Applied ${name}`);
  }
} finally {
  await connection.query("SELECT RELEASE_LOCK('exampro_migrations')");
  connection.release();
  await closeDatabase();
}
