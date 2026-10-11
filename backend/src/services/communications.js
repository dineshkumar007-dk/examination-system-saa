import nodemailer from "nodemailer";
import { randomUUID } from "node:crypto";
import { required } from "../config/env.js";
import { query, transaction } from "../config/database.js";
import { seal, unseal } from "../utils/security.js";
let mailer;
export function smtp() {
  required("SMTP_FROM");
  if (!mailer)
    mailer = nodemailer.createTransport({
      host: required("SMTP_HOST"),
      port: Number(required("SMTP_PORT")),
      secure: required("SMTP_SECURE") === "true",
      requireTLS: true,
      auth: { user: required("SMTP_USER"), pass: required("SMTP_PASSWORD") },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      tls: { rejectUnauthorized: true },
    });
  return mailer;
}
export async function sendMail(to, subject, text, idempotencyKey) {
  try {
    return await smtp().sendMail({
      from: required("SMTP_FROM"),
      to,
      subject: `EXAMPRO · ${subject}`,
      ...(idempotencyKey
        ? { headers: { "Resend-Idempotency-Key": idempotencyKey } }
        : {}),
      text: `EXAMPRO\nCentralized Computer-Based Examination System\n\n${text}\n\nIf you did not request this, contact your examination authority.`,
    });
  } catch (error) {
    if (error.status === 503) throw error;
    const safe = new Error(
      "Email delivery failed. Please retry or contact the examination authority.",
    );
    safe.status = 502;
    safe.expose = true;
    throw safe;
  }
}
export async function enqueue(userId, event, text, connection, credentials) {
  const id = randomUUID();
  await query(
    "INSERT INTO notifications(id,user_id,event,payload_encrypted) VALUES(?,?,?,?)",
    [id, userId, event, seal({ text, ...credentials })],
    connection,
  );
  return id;
}
export async function deliverQueuedNotification(notificationId) {
  try {
    await processNotifications(1, notificationId);
    const [item] = await query("SELECT status FROM notifications WHERE id=?", [
      notificationId,
    ]);
    return item?.status === "sent" ? "sent" : "queued";
  } catch {
    // Allocation has committed. A delivery or worker error must not undo it.
    return "queued";
  }
}
export async function processNotifications(limit = 20, notificationId) {
  let sent = 0;
  for (let n = 0; n < limit; n++) {
    const item = await transaction(async (c) => {
      const [row] = await query(
        "SELECT n.*,u.email FROM notifications n JOIN users u ON u.id=n.user_id WHERE (n.status='pending' OR (n.status='sending' AND n.available_at<UTC_TIMESTAMP(3))) AND n.available_at<=UTC_TIMESTAMP(3)" +
          (notificationId ? " AND n.id=?" : "") +
          " ORDER BY n.available_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        notificationId ? [notificationId] : [],
        c,
      );
      if (!row) return null;
      await query(
        "UPDATE notifications SET status='sending', attempts=attempts+1, available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE) WHERE id=?",
        [row.id],
        c,
      );
      return row;
    });
    if (!item) break;
    try {
      const payload = unseal(item.payload_encrypted);
      if (payload.examPasswordHash) {
        const [ticket] = await query(
          "SELECT exam_password_hash FROM hall_tickets h JOIN candidate_allocations a ON a.id=h.allocation_id JOIN registrations r ON r.id=a.registration_id JOIN examinations e ON e.id=r.exam_id JOIN exam_slots s ON s.id=a.slot_id WHERE h.allocation_id=? AND e.deleted_at IS NULL AND s.deleted_at IS NULL",
          [payload.allocationId],
        );
        if (!ticket || ticket.exam_password_hash !== payload.examPasswordHash) {
          await query(
            "UPDATE notifications SET status='failed',payload_encrypted=NULL,error_code='SUPERSEDED' WHERE id=?",
            [item.id],
          );
          continue;
        }
      }
      await sendMail(item.email, item.event, payload.text, item.id);
      await query(
        "UPDATE notifications SET status='sent',sent_at=UTC_TIMESTAMP(3),payload_encrypted=NULL,error_code=NULL WHERE id=?",
        [item.id],
      );
      sent++;
    } catch {
      await query(
        "UPDATE notifications SET status=?,available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE),error_code='DELIVERY_FAILED' WHERE id=?",
        [item.attempts >= 4 ? "failed" : "pending", item.id],
      );
    }
  }
  return sent;
}
