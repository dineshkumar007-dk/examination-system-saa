import { query, closeDatabase } from "../backend/src/config/database.js";
try {
  await query("SELECT 1");
  const rows = await query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if (!rows[0]?.Value) throw new Error("Database TLS is not active");
  console.log("Managed MySQL connection succeeded with TLS.");
} finally {
  await closeDatabase();
}
