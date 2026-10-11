import { Router } from "express";
import * as controllers from "../controllers/auth-controller.js";
import { z } from "zod";
import bcrypt from "bcrypt";
import PDFDocument from "pdfkit";
import { randomUUID } from "node:crypto";
import { query, transaction } from "../config/database.js";
import { required } from "../config/env.js";
import {
  id,
  code,
  examInput,
  centerInput,
  slotInput,
  questionInput,
  staffCreate,
} from "../utils/validation.js";
import { fail, digest, dateSql, token, equal } from "../utils/security.js";
import {
  authenticate,
  active,
  roles,
  csrfIssue,
  throttle,
  cookieOptions,
  centerScope,
} from "../middleware/security.js";
import * as auth from "../services/auth.js";
import * as registration from "../services/registrations.js";
import * as admin from "../services/administration.js";
import * as exam from "../services/exams.js";
import {
  enqueue,
  processNotifications,
  deliverQueuedNotification,
} from "../services/communications.js";
export const router = Router();
const paging = (req) => ({
  limit: Math.min(100, Math.max(1, Number(req.query.limit) || 25)),
  offset: Math.max(
    0,
    (Math.min(10000, Number(req.query.page) || 1) - 1) *
      Math.min(100, Math.max(1, Number(req.query.limit) || 25)),
  ),
  search: String(req.query.search || "").slice(0, 100),
});
router.get("/csrf", csrfIssue);
router.get("/health", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    res.status(503).json({ status: "unavailable", database: "not connected" });
  }
});
router.get("/jobs", async (req, res) => {
  if (!equal(req.get("authorization"), `Bearer ${required("CRON_SECRET")}`))
    fail(401, "Unauthorized.");
  const expired = await exam.finalizeExpired();
  const sent = await processNotifications();
  await query("DELETE FROM sessions WHERE expires_at<UTC_TIMESTAMP(3)");
  await query(
    "DELETE FROM workstation_sessions WHERE expires_at<UTC_TIMESTAMP(3)",
  );
  await query(
    "DELETE FROM rate_limits WHERE resets_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)",
  );
  res.json({ expired, sent });
});
router.get("/examinations", async (req, res) => {
  const p = paging(req);
  res.json(
    await query(
      "SELECT id,name,description,instructions,duration_minutes,registration_start,registration_end,fee,status FROM examinations WHERE status<>'draft' AND name LIKE ? ORDER BY registration_start DESC LIMIT ? OFFSET ?",
      [`%${p.search}%`, p.limit, p.offset],
    ),
  );
});
router.post("/auth/signup", throttle("signup", 5, 3600), controllers.signUp);
router.post("/auth/login", throttle("login", 10), controllers.logIn);
router.post(
  "/auth/invigilator-login",
  throttle("login", 10),
  controllers.invigilatorLogIn,
);
router.post(
  "/auth/resume",
  throttle("resume", 5),
  controllers.resumeVerification,
);
router.post(
  "/auth/forgot",
  throttle("forgot", 5, 3600),
  controllers.forgotPassword,
);
router.post(
  "/auth/reset",
  throttle("reset", 10, 3600),
  controllers.resetPassword,
);
router.post(
  "/exam/password",
  throttle("exam-password", 10),
  controllers.examPassword,
);
router.use(authenticate);
router.get("/me", (req, res) => res.json(auth.publicUser(req.user)));
router.post("/auth/logout", async (req, res) => {
  await query("DELETE FROM sessions WHERE token_hash=?", [
    digest(req.cookies.ep_session),
  ]);
  if (req.cookies.ep_exam)
    await query("UPDATE exam_attempts SET access_hash=? WHERE access_hash=?", [
      digest(token()),
      digest(req.cookies.ep_exam),
    ]);
  res.clearCookie("ep_session", cookieOptions());
  res.clearCookie("ep_exam", cookieOptions());
  res.json({ message: "Signed out." });
});
router.post(
  "/auth/send-code",
  throttle("send-code", 15, 3600),
  async (req, res) => {
    const { channel } = z
      .object({ channel: z.literal("email") })
      .strict()
      .parse(req.body);
    if (req.user.role !== "candidate")
      fail(403, "Candidate contact verification only.");
    await auth.sendVerification(req.user.id, channel);
    res.json({
      message: "Email code sent.",
      retryAfter: 60,
    });
  },
);
router.post(
  "/auth/verify-code",
  throttle("verify-code", 20, 3600),
  async (req, res) => {
    const d = z
      .object({ channel: z.literal("email"), code })
      .strict()
      .parse(req.body);
    if (req.user.role !== "candidate")
      fail(403, "Candidate contact verification only.");
    await auth.consumeVerification(req.user.id, d.channel, d.code);
    res.json({ message: "Contact verified." });
  },
);
router.use(active);
router.get("/notifications", async (req, res) =>
  res.json(
    await query(
      "SELECT id,event,status,sent_at,error_code FROM notifications WHERE user_id=? ORDER BY available_at DESC LIMIT 50",
      [req.user.id],
    ),
  ),
);
router.patch("/profile", async (req, res) => {
  const d = z
    .object({
      name: z.string().trim().min(2).max(120),
      address: z.string().trim().min(5).max(500).optional(),
    })
    .strict()
    .parse(req.body);
  await transaction(async (c) => {
    await query("UPDATE users SET name=? WHERE id=?", [d.name, req.user.id], c);
    if (d.address && req.user.role === "candidate")
      await query(
        "UPDATE students SET address=? WHERE user_id=?",
        [d.address, req.user.id],
        c,
      );
  });
  res.json({ message: "Profile updated." });
});
router.get("/profile", async (req, res) => {
  const [student] = await query(
    "SELECT dob,address,selected_exam_id FROM students WHERE user_id=?",
    [req.user.id],
  );
  res.json({ ...auth.publicUser(req.user), ...student });
});
router.get("/registrations/mine", roles("candidate"), async (req, res) =>
  res.json(await registration.myRegistrations(req.user.id)),
);
router.post("/registrations", roles("candidate"), async (req, res) => {
  const d = z.object({ examId: id }).strict().parse(req.body);
  res.status(201).json(await registration.register(req.user.id, d.examId));
});
router.post("/payments/simulate", roles("candidate"), async (req, res) => {
  const d = z
    .object({ registrationId: id, outcome: z.enum(["Successful", "Failed"]) })
    .strict()
    .parse(req.body);
  res.json(
    await registration.simulatePayment(
      req.user.id,
      d.registrationId,
      d.outcome,
    ),
  );
});
router.get(
  "/hall-ticket/:allocationId",
  roles("candidate"),
  async (req, res) => {
    const rows = await registration.myRegistrations(req.user.id);
    const r = rows.find(
      (r) => r.allocation_id === id.parse(req.params.allocationId),
    );
    if (!r) fail(404, "Hall ticket not found.");
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="EXAMPRO-${r.hall_number}.pdf"`,
    });
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    doc.pipe(res);
    doc
      .fontSize(24)
      .text("EXAMPRO")
      .fontSize(14)
      .text("Official examination hall ticket")
      .moveDown();
    for (const [label, value] of Object.entries({
      Candidate: req.user.name,
      Registration: r.registration_number,
      Application: r.application_number,
      "Hall ticket": r.hall_number,
      Examination: r.exam_name,
      Center: r.center_name,
      Address: r.center_address,
      "Slot start (UTC)": r.starts_at,
      "Slot end (UTC)": r.ends_at,
      "Reporting time": "Report 60 minutes before the slot begins",
    }))
      doc.fontSize(11).text(`${label}: ${value}`).moveDown(0.5);
    doc
      .moveDown()
      .fontSize(13)
      .text("Instructions")
      .fontSize(11)
      .text(r.instructions)
      .moveDown()
      .text(
        "Bring approved identification. Admission requires invigilator verification and an allocated workstation. This hall ticket does not grant examination access by itself.",
      );
    doc.end();
  },
);
router.post(
  "/exam/login",
  roles("candidate"),
  throttle("exam-login", 10),
  async (req, res) => {
    const d = z
      .object({
        registrationNumber: z.string().min(5).max(45),
        hallNumber: z.string().min(5).max(45),
        password: z.string().min(1).max(100),
      })
      .strict()
      .parse(req.body);
    const result = await exam.examLogin(
      req.user.id,
      d.registrationNumber,
      d.hallNumber,
      d.password,
      req.cookies.ep_workstation,
    );
    res.cookie("ep_exam", result.access, {
      ...cookieOptions(),
      maxAge: 8 * 3600000,
    });
    res.json({ id: result.id });
  },
);
router.get("/exam/attempt", roles("candidate"), async (req, res) =>
  res.json(
    await exam.getAttempt(
      req.user.id,
      req.cookies.ep_exam,
      req.cookies.ep_workstation,
    ),
  ),
);
router.put("/exam/answer", roles("candidate"), async (req, res) => {
  const d = z
    .object({
      questionId: id,
      answer: z.union([
        z.array(z.string().regex(/^[A-H]$/)).max(8),
        z.number(),
        z.null(),
      ]),
      review: z.boolean(),
      expectedRevision: z.number().int().min(0),
    })
    .strict()
    .parse(req.body);
  res.json(
    await exam.saveAnswer(
      req.user.id,
      req.cookies.ep_exam,
      req.cookies.ep_workstation,
      d,
    ),
  );
});
router.post("/exam/submit", roles("candidate"), async (req, res) =>
  res.json(
    await exam.submitAttempt(
      req.user.id,
      req.cookies.ep_exam,
      req.cookies.ep_workstation,
    ),
  ),
);
router.get("/manage/overview", roles("admin"), async (req, res) => {
  const [row] = await query(
    "SELECT (SELECT COUNT(*) FROM users WHERE role='candidate') AS candidates,(SELECT COUNT(*) FROM registrations) AS registrations,(SELECT COUNT(*) FROM exam_attempts WHERE status='in_progress') AS live_attempts,(SELECT COUNT(*) FROM notifications WHERE status='failed') AS failed_notifications",
  );
  res.json(row);
});
router.get(
  "/manage/examinations",
  roles("admin", "examiner"),
  async (req, res) => {
    const p = paging(req);
    res.json(
      await query(
        "SELECT * FROM examinations WHERE name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        [`%${p.search}%`, p.limit, p.offset],
      ),
    );
  },
);
router.post("/manage/examinations", roles("admin"), async (req, res) => {
  const d = examInput.parse(req.body),
    examId = randomUUID();
  if (!["draft", "open"].includes(d.status))
    fail(400, "Create examinations as draft or open.");
  await transaction(async (c) => {
    await query(
      "INSERT INTO examinations(id,name,description,instructions,duration_minutes,registration_start,registration_end,fee,status) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        examId,
        d.name,
        d.description,
        d.instructions,
        d.durationMinutes,
        dateSql(d.registrationStart),
        dateSql(d.registrationEnd),
        d.fee,
        d.status,
      ],
      c,
    );
    await admin.audit(req.user.id, "exam.create", examId, c);
  });
  res.status(201).json({ id: examId });
});
router.put("/manage/examinations/:id", roles("admin"), async (req, res) => {
  const d = examInput.parse(req.body),
    examId = id.parse(req.params.id);
  await transaction(async (c) => {
    const [old] = await query(
      "SELECT * FROM examinations WHERE id=? FOR UPDATE",
      [examId],
      c,
    );
    if (!old) fail(404, "Examination not found.");
    const transitions = {
      draft: ["draft", "open"],
      open: ["open", "closed"],
      closed: ["closed", "active"],
      active: ["active", "completed"],
      completed: ["completed"],
    };
    if (!transitions[old.status].includes(d.status))
      fail(
        409,
        `This examination is currently ${old.status}. Allowed statuses: ${transitions[old.status].join(", ")}. Refresh the examination list before editing.`,
      );
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM registrations WHERE exam_id=?",
      [examId],
      c,
    );
    if (n && (d.fee !== old.fee || d.durationMinutes !== old.duration_minutes))
      fail(409, "Fee and duration are locked after registrations exist.");
    if (old.status === "active" || old.status === "completed") {
      if (
        d.name !== old.name ||
        d.instructions !== old.instructions ||
        d.description !== old.description ||
        dateSql(d.registrationStart) !== old.registration_start.slice(0, 19) ||
        dateSql(d.registrationEnd) !== old.registration_end.slice(0, 19)
      )
        fail(409, "Examination content is locked after activation.");
    }
    if (d.status === "active") {
      const [{ q }] = await query(
        "SELECT COUNT(*) AS q FROM questions WHERE exam_id=?",
        [examId],
        c,
      );
      if (!q) fail(409, "Add questions before activating.");
    }
    if (d.status === "completed") {
      const [{ live }] = await query(
        "SELECT COUNT(*) AS live FROM exam_attempts t JOIN candidate_allocations a ON a.id=t.allocation_id JOIN registrations r ON r.id=a.registration_id WHERE r.exam_id=? AND t.status='in_progress'",
        [examId],
        c,
      );
      if (live)
        fail(
          409,
          "Finalize all live attempts before completing the examination.",
        );
    }
    await query(
      "UPDATE examinations SET name=?,description=?,instructions=?,duration_minutes=?,registration_start=?,registration_end=?,fee=?,status=? WHERE id=?",
      [
        d.name,
        d.description,
        d.instructions,
        d.durationMinutes,
        dateSql(d.registrationStart),
        dateSql(d.registrationEnd),
        d.fee,
        d.status,
        examId,
      ],
      c,
    );
    await admin.audit(req.user.id, "exam.update", examId, c);
  });
  res.json({ message: "Examination updated." });
});
router.delete("/manage/examinations/:id", roles("admin"), async (req, res) => {
  const examId = id.parse(req.params.id);
  await admin.deleteExamination(req.user.id, examId);
  res.json({ message: "Examination deleted." });
});
router.get("/manage/centers", roles("admin", "invigilator"), async (req, res) =>
  res.json(
    await query(
      req.user.role === "admin"
        ? "SELECT * FROM exam_centers ORDER BY name LIMIT 100"
        : "SELECT * FROM exam_centers WHERE id=?",
      [...(req.user.role === "admin" ? [] : [req.user.center_id])],
    ),
  ),
);
router.post("/manage/centers", roles("admin"), async (req, res) => {
  const d = centerInput.parse(req.body),
    centerId = randomUUID();
  await transaction(async (c) => {
    await query(
      "INSERT INTO exam_centers(id,name,address,city,state,capacity,active) VALUES(?,?,?,?,?,?,?)",
      [centerId, d.name, d.address, d.city, d.state, d.capacity, d.active],
      c,
    );
    await admin.audit(req.user.id, "center.create", centerId, c);
  });
  res.status(201).json({ id: centerId });
});
router.put("/manage/centers/:id", roles("admin"), async (req, res) => {
  const d = centerInput.parse(req.body),
    centerId = id.parse(req.params.id);
  await transaction(async (c) => {
    const [old] = await query(
      "SELECT id FROM exam_centers WHERE id=? FOR UPDATE",
      [centerId],
      c,
    );
    if (!old) fail(404, "Center not found.");
    const [{ n }] = await query(
      "SELECT COALESCE(MAX(capacity),0) AS n FROM exam_slots WHERE center_id=? AND ends_at>UTC_TIMESTAMP(3)",
      [centerId],
      c,
    );
    if (d.capacity < n)
      fail(409, "Capacity cannot be reduced below scheduled slot capacity.");
    await query(
      "UPDATE exam_centers SET name=?,address=?,city=?,state=?,capacity=?,active=? WHERE id=?",
      [d.name, d.address, d.city, d.state, d.capacity, d.active, centerId],
      c,
    );
    await admin.audit(req.user.id, "center.update", centerId, c);
  });
  res.json({ message: "Center updated." });
});
router.delete("/manage/centers/:id", roles("admin"), async (req, res) => {
  const centerId = id.parse(req.params.id);
  await transaction(async (c) => {
    await query("DELETE FROM exam_centers WHERE id=?", [centerId], c);
    await admin.audit(req.user.id, "center.delete", centerId, c);
  });
  res.json({ message: "Deleted." });
});
router.get(
  "/manage/computers",
  roles("admin", "invigilator"),
  async (req, res) => {
    const centerId = id.parse(req.query.centerId);
    centerScope(req.user, centerId);
    res.json(
      await query(
        "SELECT * FROM computers WHERE center_id=? ORDER BY label LIMIT 5000",
        [centerId],
      ),
    );
  },
);
router.post("/manage/computers", roles("admin"), async (req, res) => {
  const d = z
      .object({ centerId: id, label: z.string().min(1).max(50) })
      .strict()
      .parse(req.body),
    pcId = randomUUID();
  await transaction(async (c) => {
    const [center] = await query(
      "SELECT * FROM exam_centers WHERE id=? FOR UPDATE",
      [d.centerId],
      c,
    );
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM computers WHERE center_id=?",
      [d.centerId],
      c,
    );
    if (!center || n >= center.capacity)
      fail(409, "Center computer capacity has been reached.");
    await query(
      "INSERT INTO computers(id,center_id,label) VALUES(?,?,?)",
      [pcId, d.centerId, d.label],
      c,
    );
    await admin.audit(req.user.id, "computer.create", pcId, c);
  });
  res.status(201).json({ id: pcId });
});
router.patch("/manage/computers/:id", roles("admin"), async (req, res) => {
  const { active: enabled } = z
    .object({ active: z.boolean() })
    .strict()
    .parse(req.body);
  const pcId = id.parse(req.params.id);
  await transaction(async (c) => {
    await query("SELECT id FROM computers WHERE id=? FOR UPDATE", [pcId], c);
    const live = await query(
      "SELECT a.id FROM candidate_allocations a JOIN exam_slots s ON s.id=a.slot_id WHERE a.computer_id=? AND s.ends_at>UTC_TIMESTAMP(3)",
      [pcId],
      c,
    );
    if (live.length) fail(409, "Assigned computers cannot be disabled.");
    await query("UPDATE computers SET active=? WHERE id=?", [enabled, pcId], c);
    await admin.audit(req.user.id, "computer.update", pcId, c);
  });
  res.json({ message: "Computer updated." });
});
router.get("/manage/slots", roles("admin", "invigilator"), async (req, res) => {
  res.json(
    await query(
      `SELECT s.*,e.name AS exam_name,c.name AS center_name,(SELECT COUNT(*) FROM candidate_allocations a WHERE a.slot_id=s.id) AS allocated FROM exam_slots s JOIN examinations e ON e.id=s.exam_id JOIN exam_centers c ON c.id=s.center_id ${req.user.role === "invigilator" ? "WHERE s.center_id=?" : ""} ORDER BY s.starts_at DESC LIMIT 200`,
      req.user.role === "invigilator" ? [req.user.center_id] : [],
    ),
  );
});
router.post("/manage/slots", roles("admin"), async (req, res) =>
  res
    .status(201)
    .json(await admin.createSlot(req.user.id, slotInput.parse(req.body))),
);
router.delete("/manage/slots/:id", roles("admin"), async (req, res) => {
  const slotId = id.parse(req.params.id);
  await transaction(async (c) => {
    await query("DELETE FROM exam_slots WHERE id=?", [slotId], c);
    await admin.audit(req.user.id, "slot.delete", slotId, c);
  });
  res.json({ message: "Deleted." });
});
router.get("/manage/registrations", roles("admin"), async (req, res) => {
  const p = paging(req);
  res.json(
    await query(
      `SELECT r.*,u.name,u.email,e.name AS exam_name,p.status AS payment_status,a.id AS allocation_id,a.slot_id,h.hall_number FROM registrations r JOIN users u ON u.id=r.user_id JOIN examinations e ON e.id=r.exam_id LEFT JOIN payments p ON p.registration_id=r.id LEFT JOIN candidate_allocations a ON a.registration_id=r.id LEFT JOIN hall_tickets h ON h.allocation_id=a.id WHERE (r.registration_number LIKE ? OR u.name LIKE ?) ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      [`%${p.search}%`, `%${p.search}%`, p.limit, p.offset],
    ),
  );
});
router.post("/manage/allocate", roles("admin"), async (req, res) => {
  const d = z
    .object({ registrationId: id, slotId: id })
    .strict()
    .parse(req.body);
  const { notificationId, ...allocation } = await admin.allocate(
    req.user.id,
    d.registrationId,
    d.slotId,
  );
  const emailStatus = await deliverQueuedNotification(notificationId);
  res
    .status(201)
    .json({
      ...allocation,
      emailStatus,
      message:
        emailStatus === "sent"
          ? "Slot allocated. Examination credentials email sent to the student's registered email."
          : "Slot allocated. Email delivery is pending; credentials remain queued for retry. Do not allocate again.",
    });
});
router.post("/manage/activation/:id", roles("admin"), async (req, res) => {
  const allocationId = id.parse(req.params.id);
  const notificationId = await transaction(async (c) => {
    const [r] = await query(
      "SELECT r.*,h.hall_number FROM candidate_allocations a JOIN registrations r ON r.id=a.registration_id JOIN hall_tickets h ON h.allocation_id=a.id WHERE a.id=? FOR UPDATE",
      [allocationId],
      c,
    );
    if (!r) fail(404, "Allocation not found.");
    const [t] = await query(
      "SELECT id FROM exam_attempts WHERE allocation_id=?",
      [allocationId],
      c,
    );
    if (t) fail(409, "An attempt has already started.");
    const notificationId = await admin.issueActivation(
      allocationId,
      r.user_id,
      r.registration_number,
      r.hall_number,
      c,
    );
    await admin.audit(req.user.id, "activation.reissue", allocationId, c);
    return notificationId;
  });
  const emailStatus = await deliverQueuedNotification(notificationId);
  res.json({
    emailStatus,
    message:
      emailStatus === "sent"
        ? "New examination credentials emailed. The previous examination password is invalid."
        : "New credentials created; email delivery is pending and queued for retry. The previous examination password is invalid.",
  });
});
router.get("/manage/users", roles("admin"), async (req, res) => {
  const p = paging(req);
  res.json(
    await query(
      "SELECT id,name,email,phone,role,status,center_id,email_verified_at,phone_verified_at FROM users WHERE deleted_at IS NULL AND (name LIKE ? OR email LIKE ?) ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [`%${p.search}%`, `%${p.search}%`, p.limit, p.offset],
    ),
  );
});
router.post("/manage/staff", roles("admin"), async (req, res) => {
  const d = staffCreate.parse(req.body);
  const userId = randomUUID(),
    hash = await bcrypt.hash(d.password, 12);
  await transaction(async (c) => {
    const [existing] = await query(
      "SELECT id FROM users WHERE email=?",
      [d.email],
      c,
    );
    if (existing)
      fail(
        409,
        "An account already uses this email. Delete that account or use a different email.",
      );
    await query(
      "INSERT INTO users(id,name,email,password_hash,role,center_id,status,email_verified_at) VALUES(?,?,?,?,?,?,'active',UTC_TIMESTAMP(3))",
      [userId, d.name, d.email, hash, d.role, d.centerId],
      c,
    );
    await enqueue(
      userId,
      "Staff invitation",
      `The administrator has provisioned your ${d.role} account. Sign in at ${d.role === "invigilator" ? "/invigilator-login" : "/login"} using this email and the password supplied separately by your examination administrator. No password is included in this notification. If you forget it, use Forgot password with this email.`,
      c,
    );
    await admin.audit(req.user.id, "staff.create", userId, c);
  });
  res.status(201).json({ id: userId });
});
router.patch("/manage/users/:id", roles("admin"), async (req, res) => {
  const d = z
      .object({
        status: z.enum(["active", "disabled"]),
        role: z.enum(["candidate", "invigilator", "examiner"]),
        centerId: id.nullable(),
      })
      .strict()
      .parse(req.body),
    userId = id.parse(req.params.id);
  if (userId === req.user.id)
    fail(409, "You cannot change your own administrative role.");
  await transaction(async (c) => {
    const [old] = await query(
      "SELECT * FROM users WHERE id=? FOR UPDATE",
      [userId],
      c,
    );
    if (!old || old.deleted_at || old.role === "admin")
      fail(
        409,
        "Administrative accounts must be managed through the secure operator process.",
      );
    if (d.status === "active" && !old.email_verified_at)
      fail(409, "Verification must be completed before activation.");
    if (d.role === "invigilator" && !d.centerId) fail(400, "Assign a center.");
    if (old.role === "candidate" && d.role !== "candidate") {
      const [{ n }] = await query(
        "SELECT COUNT(*) AS n FROM registrations WHERE user_id=?",
        [userId],
        c,
      );
      if (n) fail(409, "Registered candidates cannot be converted into staff.");
    }
    await query(
      "UPDATE users SET status=?,role=?,center_id=? WHERE id=?",
      [d.status, d.role, d.centerId, userId],
      c,
    );
    await query("DELETE FROM sessions WHERE user_id=?", [userId], c);
    await admin.audit(req.user.id, "user.update", userId, c);
  });
  res.json({ message: "User updated and sessions revoked." });
});
router.delete("/manage/users/:id", roles("admin"), async (req, res) => {
  const result = await admin.deleteUser(req.user.id, id.parse(req.params.id));
  res.json({
    message: result.retainedExamRecords
      ? "User access removed and email released. Examination records retained."
      : "User deleted from the database. The email can be used for a new account.",
  });
});
router.get(
  "/manage/questions",
  roles("admin", "examiner"),
  async (req, res) => {
    const examId = id.parse(req.query.examId);
    const rows = await query(
      "SELECT q.*,k.correct_answer,k.tolerance FROM questions q JOIN answer_keys k ON k.question_id=q.id WHERE q.exam_id=? ORDER BY position LIMIT 500",
      [examId],
    );
    for (const q of rows)
      q.options = await query(
        "SELECT option_id AS id,option_text AS text FROM question_options WHERE question_id=?",
        [q.id],
      );
    res.json(rows);
  },
);
router.post("/manage/questions", roles("admin", "examiner"), async (req, res) =>
  res
    .status(201)
    .json(await admin.saveQuestion(req.user.id, questionInput.parse(req.body))),
);
router.put(
  "/manage/questions/:id",
  roles("admin", "examiner"),
  async (req, res) =>
    res.json(
      await admin.saveQuestion(
        req.user.id,
        questionInput.parse(req.body),
        id.parse(req.params.id),
      ),
    ),
);
router.delete(
  "/manage/questions/:id",
  roles("admin", "examiner"),
  async (req, res) => {
    const questionId = id.parse(req.params.id);
    await transaction(async (c) => {
      const [q] = await query(
        "SELECT q.id,e.status FROM questions q JOIN examinations e ON e.id=q.exam_id WHERE q.id=? FOR UPDATE",
        [questionId],
        c,
      );
      if (!q || ["active", "completed"].includes(q.status))
        fail(409, "This question is locked.");
      await query("DELETE FROM questions WHERE id=?", [questionId], c);
      await admin.audit(req.user.id, "question.delete", questionId, c);
    });
    res.json({ message: "Question deleted." });
  },
);
router.get(
  "/invigilator/candidates",
  roles("admin", "invigilator"),
  async (req, res) => {
    const p = paging(req);
    res.json(
      await query(
        `SELECT a.*,r.registration_number,u.name,e.name AS exam_name,h.hall_number,s.center_id,s.starts_at,s.ends_at,pc.label AS computer_label,t.status AS attempt_status FROM candidate_allocations a JOIN registrations r ON r.id=a.registration_id JOIN users u ON u.id=r.user_id JOIN hall_tickets h ON h.allocation_id=a.id JOIN exam_slots s ON s.id=a.slot_id JOIN examinations e ON e.id=r.exam_id LEFT JOIN computers pc ON pc.id=a.computer_id LEFT JOIN exam_attempts t ON t.allocation_id=a.id WHERE (r.registration_number LIKE ? OR h.hall_number LIKE ? OR u.name LIKE ?) ${req.user.role === "invigilator" ? "AND s.center_id=?" : ""} ORDER BY s.starts_at DESC LIMIT ? OFFSET ?`,
        [
          `%${p.search}%`,
          `%${p.search}%`,
          `%${p.search}%`,
          ...(req.user.role === "invigilator" ? [req.user.center_id] : []),
          p.limit,
          p.offset,
        ],
      ),
    );
  },
);
router.post(
  "/invigilator/verify",
  roles("admin", "invigilator"),
  async (req, res) => {
    const d = z
      .object({
        allocationId: id,
        computerId: id.nullable(),
        attendance: z.enum(["Present", "Verified", "Absent"]),
        identityChecked: z.boolean(),
      })
      .strict()
      .parse(req.body);
    if (d.attendance === "Verified" && !d.identityChecked)
      fail(400, "Confirm physical identity inspection before verification.");
    await admin.verifyAndAssign(
      req.user,
      d.allocationId,
      d.computerId,
      d.attendance,
    );
    res.json({ message: "Attendance and computer assignment saved." });
  },
);
router.post(
  "/invigilator/workstation",
  roles("admin", "invigilator"),
  async (req, res) => {
    const d = z.object({ slotId: id, computerId: id }).strict().parse(req.body);
    const result = await admin.enrollWorkstation(
      req.user,
      d.slotId,
      d.computerId,
    );
    res.cookie("ep_workstation", result.value, {
      ...cookieOptions(),
      maxAge: result.expires - Date.now(),
    });
    res.json({
      message:
        "Exam access granted to this browser for the chosen computer and slot. Sign out of staff access before the assigned candidate signs in.",
      expires: result.expires,
    });
  },
);
router.get("/manage/attempts", roles("admin"), async (req, res) => {
  const p = paging(req);
  res.json(
    await query(
      "SELECT t.id,t.started_at,t.deadline,t.submitted_at,t.status,u.name,r.registration_number,e.name AS exam_name,rs.status AS result_status,rs.score FROM exam_attempts t JOIN candidate_allocations a ON a.id=t.allocation_id JOIN registrations r ON r.id=a.registration_id JOIN users u ON u.id=r.user_id JOIN examinations e ON e.id=r.exam_id LEFT JOIN results rs ON rs.attempt_id=t.id WHERE u.name LIKE ? ORDER BY t.started_at DESC LIMIT ? OFFSET ?",
      [`%${p.search}%`, p.limit, p.offset],
    ),
  );
});
router.post("/manage/evaluate", roles("admin"), async (req, res) => {
  const d = z.object({ examId: id }).strict().parse(req.body);
  await exam.finalizeExpired();
  await exam.evaluate(req.user.id, d.examId);
  res.json({
    message: "Submitted attempts evaluated. Results remain private.",
  });
});
router.post("/manage/publish", roles("admin"), async (req, res) => {
  const d = z.object({ examId: id }).strict().parse(req.body);
  await exam.publish(req.user.id, d.examId);
  res.json({ message: "Results published." });
});
router.get("/manage/audit", roles("admin"), async (req, res) => {
  const p = paging(req);
  res.json(
    await query(
      "SELECT a.*,u.name AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ? OFFSET ?",
      [p.limit, p.offset],
    ),
  );
});
router.get("/manage/notifications", roles("admin"), async (req, res) =>
  res.json(
    await query(
      "SELECT n.id,n.event,n.status,n.attempts,n.sent_at,n.error_code,u.email FROM notifications n JOIN users u ON u.id=n.user_id ORDER BY n.available_at DESC LIMIT 100",
    ),
  ),
);
router.post(
  "/manage/notifications/:id/retry",
  roles("admin"),
  async (req, res) => {
    const notificationId = id.parse(req.params.id);
    await query(
      "UPDATE notifications SET status='pending',attempts=0,available_at=UTC_TIMESTAMP(3) WHERE id=? AND status='failed'",
      [notificationId],
    );
    await admin.audit(req.user.id, "notification.retry", notificationId);
    res.json({ message: "Retry queued." });
  },
);
router.post("/manage/announce", roles("admin"), async (req, res) => {
  const d = z
    .object({ examId: id, message: z.string().min(10).max(3000) })
    .strict()
    .parse(req.body);
  await transaction(async (c) => {
    const rows = await query(
      "SELECT user_id FROM registrations WHERE exam_id=? AND status='completed'",
      [d.examId],
      c,
    );
    for (const r of rows)
      await enqueue(r.user_id, "Examination announcement", d.message, c);
    await admin.audit(req.user.id, "exam.announce", d.examId, c);
  });
  res.json({ message: "Announcement queued for eligible candidates." });
});
