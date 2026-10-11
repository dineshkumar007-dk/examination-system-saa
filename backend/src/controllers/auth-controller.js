import { z } from "zod";
import bcrypt from "bcrypt";
import { query } from "../config/database.js";
import {
  email,
  password,
  code,
  signup as signupSchema,
} from "../utils/validation.js";
import { digest, fail } from "../utils/security.js";
import { createSession, cookieOptions } from "../middleware/security.js";
import * as auth from "../services/auth.js";
import * as admin from "../services/administration.js";
export const signUp = async (req, res) => {
  const d = signupSchema.parse(req.body);
  const userId = await auth.signup(d);
  await createSession(userId, res);
  res.status(201).json({
    message:
      "Account created. Request and verify your email code to activate your account.",
  });
};
const signIn = async (req, res, requiredRole) => {
  const d = z
    .object({
      identity: z.string().min(3).max(254),
      password: z.string().min(1).max(100),
    })
    .strict()
    .parse(req.body);
  const user = await auth.login(d.identity, d.password, requiredRole);
  if (req.cookies.ep_session)
    await query("DELETE FROM sessions WHERE token_hash=?", [
      digest(req.cookies.ep_session),
    ]);
  await createSession(user.id, res);
  res.json(auth.publicUser(user));
};
export const logIn = (req, res) => signIn(req, res);
export const invigilatorLogIn = (req, res) => signIn(req, res, "invigilator");
export const resumeVerification = async (req, res) => {
  const d = z
    .object({ email, password: z.string().min(1).max(100) })
    .strict()
    .parse(req.body);
  const [u] = await query(
    "SELECT * FROM users WHERE email=? AND role='candidate' AND status='pending'",
    [d.email],
  );
  const valid = await bcrypt.compare(
    d.password,
    u?.password_hash ||
      "$2b$12$9AkRfyYo8.RfiViTdXOnxOdRRvZ8SNUS66rw/dcXXRQMLtURNCf5e",
  );
  if (!u || !valid) fail(401, "Invalid credentials or account is unavailable.");
  await createSession(u.id, res);
  res.json({ message: "Continue verification." });
};
export const forgotPassword = async (req, res) => {
  const d = z.object({ email }).strict().parse(req.body);
  await auth.recover(d.email);
  res.json({
    message: "If the account is eligible, a recovery code has been sent.",
  });
};
export const resetPassword = async (req, res) => {
  const d = z
    .object({ email, code, password, confirmPassword: z.string() })
    .strict()
    .refine((d) => d.password === d.confirmPassword, "Passwords must match")
    .parse(req.body);
  await auth.resetPassword(d.email, d.code, d.password);
  res.clearCookie("ep_session", cookieOptions());
  res.json({ message: "Password changed. Sign in again." });
};
export const examPassword = async (req, res) => {
  const d = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      password,
      confirmPassword: z.string(),
    })
    .strict()
    .refine((d) => d.password === d.confirmPassword, "Passwords must match")
    .parse(req.body);
  await admin.setupExamPassword(d.token, d.password);
  res.json({ message: "Examination password set." });
};
