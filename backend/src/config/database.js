import mysql from "mysql2/promise";
import { required } from "./env.js";
let pool;
export function database() {
  if (!pool)
    pool = mysql.createPool({
      host: required("DB_HOST"),
      port: Number(required("DB_PORT")),
      database: required("DB_NAME"),
      user: required("DB_USER"),
      password: required("DB_PASSWORD"),
      ssl: {
        ca: Buffer.from(required("DB_SSL_CA_BASE64"), "base64").toString(),
        rejectUnauthorized: true,
        verifyIdentity: true,
      },
      connectionLimit: Math.min(
        10,
        Math.max(1, Number(process.env.DB_POOL_SIZE || 3)),
      ),
      waitForConnections: true,
      queueLimit: 50,
      connectTimeout: 10000,
      timezone: "Z",
      decimalNumbers: true,
      dateStrings: true,
    });
  return pool;
}
export async function query(sql, params = [], connection = database()) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}
export async function transaction(fn) {
  const connection = await database().getConnection();
  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
