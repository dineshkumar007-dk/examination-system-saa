import {
  randomBytes,
  randomInt,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { required } from "../config/env.js";
export const token = () => randomBytes(32).toString("hex");
export const otp = () => String(randomInt(100000, 1000000));
export function digest(value) {
  const secret = required("APP_SECRET");
  if (secret.length < 64)
    throw new Error("APP_SECRET must contain at least 64 characters");
  return createHmac("sha256", secret).update(value).digest("hex");
}
export function equal(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && timingSafeEqual(x, y);
}
export function seal(value) {
  const key = Buffer.from(required("DATA_ENCRYPTION_KEY"), "hex");
  if (key.length !== 32)
    throw new Error("DATA_ENCRYPTION_KEY must be 64 hex characters");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function unseal(value) {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(required("DATA_ENCRYPTION_KEY"), "hex"),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(data.subarray(28)),
      cipher.final(),
    ]).toString(),
  );
}
export const dateSql = (date) =>
  new Date(date).toISOString().slice(0, 19).replace("T", " ");
export const nowMs = (value) =>
  new Date(
    String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z"),
  ).getTime();
export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  throw error;
}
