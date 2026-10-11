import { randomUUID } from "node:crypto";
import { query, transaction } from "../config/database.js";
import { fail } from "../utils/security.js";
import { enqueue } from "./communications.js";
export async function register(userId, examId) {
  return transaction(async (c) => {
    const [user] = await query(
      "SELECT * FROM users WHERE id=? FOR UPDATE",
      [userId],
      c,
    );
    if (
      user?.status !== "active" ||
      !user.email_verified_at ||
      user.role !== "candidate"
    )
      fail(403, "Only verified candidates may register.");
    const [exam] = await query(
      "SELECT * FROM examinations WHERE id=? AND status='open' AND UTC_TIMESTAMP(3) BETWEEN registration_start AND registration_end FOR UPDATE",
      [examId],
      c,
    );
    if (!exam) fail(409, "Registration is closed for this examination.");
    const id = randomUUID(),
      registrationNumber = `EXP-${id}`,
      applicationNumber = `APP-${randomUUID()}`;
    await query(
      "INSERT INTO registrations(id,registration_number,application_number,user_id,exam_id,status) VALUES(?,?,?,?,?,?)",
      [
        id,
        registrationNumber,
        applicationNumber,
        userId,
        examId,
        exam.fee > 0 ? "payment_pending" : "completed",
      ],
      c,
    );
    if (exam.fee > 0)
      await query(
        "INSERT INTO payments(id,registration_id,user_id,amount) VALUES(?,?,?,?)",
        [randomUUID(), id, userId, exam.fee],
        c,
      );
    await enqueue(
      userId,
      "Registration received",
      `Your registration ${registrationNumber} for ${exam.name} is ${exam.fee > 0 ? "pending the explicitly simulated payment" : "completed"}. Schedule and hall ticket information will follow.`,
      c,
    );
    return {
      id,
      registrationNumber,
      applicationNumber,
      status: exam.fee > 0 ? "payment_pending" : "completed",
    };
  });
}
export async function simulatePayment(userId, registrationId, outcome) {
  return transaction(async (c) => {
    const [reg] = await query(
      "SELECT * FROM registrations WHERE id=? AND user_id=? FOR UPDATE",
      [registrationId, userId],
      c,
    );
    if (!reg || reg.status === "cancelled")
      fail(404, "Registration not found.");
    const [pay] = await query(
      "SELECT * FROM payments WHERE registration_id=? FOR UPDATE",
      [reg.id],
      c,
    );
    if (!pay) fail(409, "This examination has no payment requirement.");
    if (pay.status === "Successful")
      return { status: "Successful", mode: "simulation" };
    await query(
      "UPDATE payments SET status=?,paid_at=UTC_TIMESTAMP(3) WHERE id=?",
      [outcome, pay.id],
      c,
    );
    if (outcome === "Successful")
      await query(
        "UPDATE registrations SET status='completed' WHERE id=?",
        [reg.id],
        c,
      );
    await enqueue(
      userId,
      "Simulated payment update",
      `SIMULATION ONLY — no money was collected. Registration ${reg.registration_number}: ${outcome}.`,
      c,
    );
    return { status: outcome, mode: "simulation" };
  });
}
export async function myRegistrations(userId) {
  return query(
    `SELECT r.*,e.name AS exam_name,e.instructions,p.status AS payment_status,p.mode AS payment_mode,p.amount,
    a.id AS allocation_id,a.attendance,h.hall_number,(h.exam_password_hash IS NOT NULL) AS exam_password_set,
    s.starts_at,s.ends_at,c.name AS center_name,c.address AS center_address,pc.label AS computer_label,
    t.status AS attempt_status,t.submitted_at,rs.status AS result_status,CASE WHEN rs.status='Published' THEN rs.score ELSE NULL END AS score
    FROM registrations r JOIN examinations e ON e.id=r.exam_id LEFT JOIN payments p ON p.registration_id=r.id
    LEFT JOIN candidate_allocations a ON a.registration_id=r.id LEFT JOIN hall_tickets h ON h.allocation_id=a.id
    LEFT JOIN exam_slots s ON s.id=a.slot_id LEFT JOIN exam_centers c ON c.id=s.center_id LEFT JOIN computers pc ON pc.id=a.computer_id
    LEFT JOIN exam_attempts t ON t.allocation_id=a.id LEFT JOIN results rs ON rs.attempt_id=t.id WHERE r.user_id=? ORDER BY r.created_at DESC`,
    [userId],
  );
}
