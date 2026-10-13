import { query, transaction } from "../config/database.js";
import { appUrl } from "../config/env.js";
import { digest, token, equal, fail } from "../utils/security.js";
import { validAdminAccess } from "./admin-access.js";
export const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
});
export function csrfIssue(req, res) {
  const value = token();
  res.cookie("ep_csrf", `${value}.${digest(`csrf:${value}`)}`, {
    ...cookieOptions(),
    maxAge: 8 * 3600000,
  });
  res.json({ token: value });
}
export function csrfGuard(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("origin") !== appUrl())
    return next(
      Object.assign(new Error("Request origin is not allowed."), {
        status: 403,
        expose: true,
      }),
    );
  const [value, signature] = String(req.cookies.ep_csrf || "").split(".");
  if (
    !value ||
    !equal(signature, digest(`csrf:${value}`)) ||
    !equal(value, req.get("x-csrf-token"))
  )
    return next(
      Object.assign(
        new Error("Your form expired. Refresh the page and try again."),
        { status: 403, expose: true },
      ),
    );
  next();
}
export async function rateLimit(key, maximum, seconds) {
  const allowed = await transaction(async (c) => {
    const hash = digest(`rate:${key}`);
    await query(
      "INSERT IGNORE INTO rate_limits(bucket_key,hits,resets_at) VALUES(?,0,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND))",
      [hash, seconds],
      c,
    );
    const [row] = await query(
      "SELECT hits,resets_at<=UTC_TIMESTAMP(3) AS expired FROM rate_limits WHERE bucket_key=? FOR UPDATE",
      [hash],
      c,
    );
    if (row.expired) {
      await query(
        "UPDATE rate_limits SET hits=1,resets_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND) WHERE bucket_key=?",
        [seconds, hash],
        c,
      );
      return true;
    }
    if (row.hits >= maximum) return false;
    await query(
      "UPDATE rate_limits SET hits=hits+1 WHERE bucket_key=?",
      [hash],
      c,
    );
    return true;
  });
  if (!allowed)
    fail(429, "Too many requests. Please wait before trying again.");
}
export const throttle =
  (name, maximum = 20, seconds = 900) =>
  async (req, res, next) => {
    try {
      await rateLimit(`${name}:${req.ip}`, maximum, seconds);
      const identity =
        req.body?.email || req.body?.identity || req.body?.registrationNumber;
      if (identity)
        await rateLimit(
          `${name}:identity:${String(identity).toLowerCase()}`,
          maximum,
          seconds,
        );
      next();
    } catch (e) {
      next(e);
    }
  };
export async function createSession(userId, res, connection) {
  const value = token();
  await query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 8 HOUR))",
    [digest(value), userId],
    connection,
  );
  res.cookie("ep_session", value, { ...cookieOptions(), maxAge: 8 * 3600000 });
  return value;
}
export async function authenticate(req, res, next) {
  try {
    if (!req.cookies.ep_session) fail(401, "Please sign in.");
    const [user] = await query(
      "SELECT u.id,u.name,u.email,u.phone,u.role,u.status,u.center_id,u.email_verified_at,u.phone_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)",
      [digest(req.cookies.ep_session)],
    );
    if (!user || user.status === "disabled")
      fail(401, "Your session expired or your account is unavailable.");
    if (
      user.role === "admin" &&
      !validAdminAccess(
        req.get("X-Admin-Access"),
        user.id,
        req.cookies.ep_session,
      )
    )
      fail(
        401,
        "Administrator access requires a fresh password sign-in in this tab.",
      );
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}
export function active(req, res, next) {
  if (req.user.status !== "active" || !req.user.email_verified_at)
    return next(
      Object.assign(
        new Error("Complete contact verification before continuing."),
        { status: 403, expose: true },
      ),
    );
  next();
}
export const roles =
  (...allowed) =>
  (req, res, next) => {
    if (!allowed.includes(req.user.role))
      return next(
        Object.assign(
          new Error("You do not have permission for this action."),
          { status: 403, expose: true },
        ),
      );
    next();
  };
export function centerScope(user, centerId) {
  if (user.role !== "admin" && user.center_id !== centerId)
    fail(403, "This center is outside your assignment.");
}
export function errorHandler(error, req, res, _next) {
  if (error.name === "ZodError")
    return res.status(400).json({
      error: "Check the form fields.",
      fields: error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
  if (error.code === "ER_DUP_ENTRY")
    return res.status(409).json({
      error:
        "This record conflicts with an existing registration or assignment.",
    });
  if (error.code === "ER_ROW_IS_REFERENCED_2")
    return res
      .status(409)
      .json({ error: "This record is in use. Deactivate it instead." });
  if (error.type === "entity.too.large")
    return res
      .status(413)
      .json({ error: "Request exceeds the permitted size." });
  if (error.status === 429) res.set("Retry-After", "60");
  if (!error.expose)
    console.error(
      JSON.stringify({
        event: "request_failed",
        code: /^[A-Z_0-9]+$/.test(error.code || "") ? error.code : "INTERNAL",
        route: req.route?.path || "unknown",
      }),
    );
  res.status(error.status || 500).json({
    error: error.expose
      ? error.message
      : "The service is unavailable. Please retry or contact the examination authority.",
  });
}
