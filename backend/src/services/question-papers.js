import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { query, transaction } from "../config/database.js";
import { fail } from "../utils/security.js";
import { audit } from "./administration.js";
import { parsePowerPoint } from "./powerpoint.js";

const option = z
  .object({
    id: z.enum(["A", "B", "C", "D", "E", "F", "G", "H"]),
    text: z.string().max(2000),
  })
  .strict();
const media = z
  .object({
    mime: z.enum(["image/png", "image/jpeg"]),
    data: z
      .string()
      .max(350000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();
const question = z
  .object({
    number: z.number().int().min(1).max(10000),
    prompt: z.string().max(10000),
    options: z.array(option).max(8),
    answer: z.enum(["A", "B", "C", "D", "E", "F", "G", "H"]).nullable(),
    marks: z.number().positive().max(100),
    negativeMarks: z.number().min(0).max(100),
    media: z.array(media).max(10),
    slides: z.array(z.number().int().positive()).max(300),
  })
  .strict();
const documentSchema = z
  .object({
    questions: z.array(question).max(300),
    issues: z
      .array(
        z.object({ slide: z.number().int(), message: z.string().max(500) }),
      )
      .max(1500),
    slideCount: z.number().int().min(0).max(300),
    slides: z
      .array(
        z.object({
          number: z.number().int(),
          lines: z.array(z.string().max(10000)).max(2000),
          media: z.array(media).max(30),
          issues: z.array(z.string()).optional(),
        }),
      )
      .max(300)
      .optional(),
    resolutions: z.record(z.string(), z.string().max(2000)),
    reviewed: z.boolean(),
  })
  .strict();
export const paperInput = z
  .object({
    title: z.string().trim().min(3).max(150),
    subject: z.string().trim().min(2).max(150),
    description: z.string().max(2000),
    durationMinutes: z.number().int().min(1).max(360),
    totalMarks: z.number().positive().max(30000),
  })
  .strict();
export function validatePaperDocument(value, totalMarks, publishing = false) {
  const doc = documentSchema.parse(value);
  if (Buffer.byteLength(JSON.stringify(doc)) > 1800000)
    fail(413, "Paper preview is too large. Reduce image sizes.");
  for (const q of doc.questions)
    for (const m of q.media) {
      const bytes = Buffer.from(m.data, "base64");
      const valid =
        m.mime === "image/png"
          ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!valid) fail(400, "Invalid question image.");
    }
  if (!publishing) return doc;
  if (!doc.reviewed || !doc.questions.length)
    fail(400, "Review the slide preview and all questions before publication.");
  const seen = new Set();
  let sum = 0;
  for (const q of doc.questions) {
    if (seen.has(q.number)) fail(400, `Duplicate question number ${q.number}.`);
    seen.add(q.number);
    if (
      q.prompt.trim().length < 5 ||
      q.options.length < 2 ||
      new Set(q.options.map((o) => o.id)).size !== q.options.length ||
      q.options.some((o) => !o.text.trim())
    )
      fail(
        400,
        `Question ${q.number} needs a prompt and distinct, nonempty options.`,
      );
    if (!q.answer || !q.options.some((o) => o.id === q.answer))
      fail(400, `Enter a valid answer key for question ${q.number}.`);
    sum += q.marks;
  }
  if (Math.round(sum * 100) !== Math.round(totalMarks * 100))
    fail(400, `Question marks add up to ${sum}; total marks must match.`);
  for (const [i] of doc.issues.entries())
    if ((doc.resolutions[String(i)] || "").trim().length < 5)
      fail(
        400,
        `Resolve slide issue ${i + 1} with a review note before publishing.`,
      );
  return doc;
}
export function parseBulkKey(text, numbers) {
  const result = {},
    allowed = new Set(numbers);
  for (const line of text
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter(Boolean)) {
    const match = line.match(/^(\d+)\s*[).:-]\s*([A-H])\s*$/i);
    if (!match)
      fail(400, `Invalid answer-key line: ${line.slice(0, 50)}. Use 1) B.`);
    const n = Number(match[1]);
    if (!allowed.has(n) || result[n])
      fail(400, `Unknown or duplicate question number ${n}.`);
    result[n] = match[2].toUpperCase();
  }
  return result;
}
export async function assignedExaminations(actor) {
  return query(
    "SELECT e.id,e.name,e.description,e.instructions,e.duration_minutes,e.status FROM examinations e JOIN examiner_assignments a ON a.exam_id=e.id WHERE a.examiner_id=? AND e.deleted_at IS NULL ORDER BY e.created_at DESC LIMIT 100",
    [actor],
  );
}
async function lockExam(actor, examId, c) {
  const [exam] = await query(
    "SELECT e.* FROM examinations e JOIN examiner_assignments a ON a.exam_id=e.id JOIN users u ON u.id=a.examiner_id WHERE e.id=? AND a.examiner_id=? AND u.role='examiner' AND u.status='active' AND e.deleted_at IS NULL FOR UPDATE",
    [examId, actor],
    c,
  );
  if (!exam) fail(404, "Assigned examination not found.");
  return exam;
}
function mutable(exam) {
  if (["active", "completed"].includes(exam.status))
    fail(409, "The examination paper is locked after activation.");
}
async function lockedPaper(actor, paperId, c, edit = true) {
  const [row] = await query(
    "SELECT exam_id FROM question_papers WHERE id=? AND examiner_id=?",
    [paperId, actor],
    c,
  );
  if (!row) fail(404, "Question paper not found.");
  const exam = await lockExam(actor, row.exam_id, c);
  const [paper] = await query(
    "SELECT * FROM question_papers WHERE id=? AND examiner_id=? FOR UPDATE",
    [paperId, actor],
    c,
  );
  if (edit) {
    mutable(exam);
    if (paper.status !== "draft")
      fail(409, "Published papers are immutable. Only drafts may be edited.");
  }
  return { paper, exam };
}
export async function listPapers(actor, page = 1, status) {
  const scope =
    " FROM question_papers p JOIN examiner_assignments a ON a.exam_id=p.exam_id JOIN examinations e ON e.id=p.exam_id WHERE p.examiner_id=? AND a.examiner_id=? AND e.deleted_at IS NULL";
  const [counts] = await query(
    "SELECT COUNT(*) AS total,COALESCE(SUM(p.status='draft'),0) AS draft,COALESCE(SUM(p.status='published'),0) AS published" +
      scope,
    [actor, actor],
  );
  const items = await query(
    "SELECT p.id,p.exam_id,p.title,p.subject,p.description,p.duration_minutes,p.total_marks,p.status,p.revision,p.source_name,p.updated_at,p.published_at,e.name AS exam_name" +
      scope +
      (status ? " AND p.status=?" : "") +
      " ORDER BY p.updated_at DESC,p.id LIMIT 25 OFFSET ?",
    [actor, actor, ...(status ? [status] : []), (page - 1) * 25],
  );
  return {
    items,
    counts,
    total: status ? counts[status] : counts.total,
    page,
    pageSize: 25,
  };
}
export async function getPaper(actor, paperId) {
  const [paper] = await query(
    "SELECT p.id,p.exam_id,p.title,p.subject,p.description,p.duration_minutes,p.total_marks,p.status,p.document,p.revision,p.source_name,p.source_sha256,p.updated_at FROM question_papers p JOIN examiner_assignments a ON a.exam_id=p.exam_id JOIN examinations e ON e.id=p.exam_id WHERE p.id=? AND p.examiner_id=? AND a.examiner_id=? AND e.deleted_at IS NULL",
    [paperId, actor, actor],
  );
  if (!paper) fail(404, "Question paper not found.");
  return paper;
}
export async function createPaper(actor, examId, input) {
  const d = paperInput.parse(input);
  return transaction(async (c) => {
    const exam = await lockExam(actor, examId, c);
    mutable(exam);
    if (d.durationMinutes !== exam.duration_minutes)
      fail(400, "Use the duration configured for your assigned examination.");
    const id = randomUUID();
    await query(
      "INSERT INTO question_papers(id,exam_id,examiner_id,title,subject,description,duration_minutes,total_marks,document) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        id,
        examId,
        actor,
        d.title,
        d.subject,
        d.description,
        d.durationMinutes,
        d.totalMarks,
        JSON.stringify({
          questions: [],
          issues: [],
          slideCount: 0,
          resolutions: {},
          reviewed: false,
        }),
      ],
      c,
    );
    await audit(actor, "paper.create", id, c);
    return { id };
  });
}
export async function uploadPaper(
  actor,
  paperId,
  expectedRevision,
  buffer,
  name,
) {
  // Check ownership before parsing attacker-controlled content or invoking a converter.
  const existing = await getPaper(actor, paperId);
  if (existing.status !== "draft") fail(409, "Only drafts accept uploads.");
  if (existing.revision !== expectedRevision)
    fail(409, "A newer draft exists. Reload before uploading.");
  const document = await parsePowerPoint(buffer, name);
  validatePaperDocument(document, existing.total_marks);
  await transaction(async (c) => {
    const { paper } = await lockedPaper(actor, paperId, c);
    if (paper.revision !== expectedRevision)
      fail(409, "A newer draft exists. Reload before uploading.");
    await query(
      "UPDATE question_papers SET document=?,source_name=?,source_sha256=?,source_bytes=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
      [
        JSON.stringify(document),
        name,
        createHash("sha256").update(buffer).digest("hex"),
        buffer,
        paperId,
      ],
      c,
    );
    await audit(actor, "paper.upload", paperId, c);
  });
  return getPaper(actor, paperId);
}
export async function savePaper(
  actor,
  paperId,
  expectedRevision,
  input,
  document,
) {
  const d = paperInput.parse(input),
    doc = validatePaperDocument(document, d.totalMarks);
  return transaction(async (c) => {
    const { paper, exam } = await lockedPaper(actor, paperId, c);
    if (paper.revision !== expectedRevision)
      fail(409, "A newer draft exists. Reload before saving.");
    if (d.durationMinutes !== exam.duration_minutes)
      fail(400, "Paper duration must match the assigned examination.");
    // Original extraction diagnostics cannot be removed by the client to skip review.
    const original =
      typeof paper.document === "string"
        ? JSON.parse(paper.document)
        : paper.document;
    doc.issues = original.issues;
    doc.slideCount = original.slideCount;
    doc.slides = original.slides;
    await query(
      "UPDATE question_papers SET title=?,subject=?,description=?,duration_minutes=?,total_marks=?,document=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?",
      [
        d.title,
        d.subject,
        d.description,
        d.durationMinutes,
        d.totalMarks,
        JSON.stringify(doc),
        paperId,
      ],
      c,
    );
    await audit(actor, "paper.save", paperId, c);
    return { revision: paper.revision + 1 };
  });
}
export async function publishPaper(actor, paperId, expectedRevision) {
  return transaction(async (c) => {
    const { paper, exam } = await lockedPaper(actor, paperId, c);
    if (paper.revision !== expectedRevision)
      fail(409, "Reload the latest paper before publishing.");
    if (!paper.source_sha256)
      fail(400, "Upload a PowerPoint before publishing.");
    if (paper.duration_minutes !== exam.duration_minutes)
      fail(
        409,
        "The assigned examination duration changed. Update and save the paper first.",
      );
    const [{ n }] = await query(
      "SELECT COUNT(*) AS n FROM exam_attempts t JOIN candidate_allocations a ON a.id=t.allocation_id JOIN registrations r ON r.id=a.registration_id WHERE r.exam_id=?",
      [paper.exam_id],
      c,
    );
    if (n)
      fail(409, "An examination with attempts cannot replace its questions.");
    const [published] = await query(
      "SELECT id FROM question_papers WHERE exam_id=? AND status='published'",
      [paper.exam_id],
      c,
    );
    if (published)
      fail(409, "This examination already has a published question paper.");
    const doc = validatePaperDocument(
      typeof paper.document === "string"
        ? JSON.parse(paper.document)
        : paper.document,
      paper.total_marks,
      true,
    );
    await query("DELETE FROM questions WHERE exam_id=?", [paper.exam_id], c);
    const rows = doc.questions.map((q, i) => ({
      q,
      id: randomUUID(),
      position: i + 1,
    }));
    const placeholders = rows.map(() => "(?,?,'MCQ',?,?,?,?,?)").join(",");
    await query(
      "INSERT INTO questions(id,exam_id,type,prompt,marks,negative_marks,position,media) VALUES " +
        placeholders,
      rows.flatMap(({ q, id, position }) => [
        id,
        paper.exam_id,
        q.prompt,
        q.marks,
        q.negativeMarks,
        position,
        JSON.stringify(q.media),
      ]),
      c,
    );
    const options = rows.flatMap(({ q, id }) =>
      q.options.map((o) => [id, o.id, o.text]),
    );
    await query(
      "INSERT INTO question_options(question_id,option_id,option_text) VALUES " +
        options.map(() => "(?,?,?)").join(","),
      options.flat(),
      c,
    );
    await query(
      "INSERT INTO answer_keys(question_id,correct_answer,tolerance) VALUES " +
        rows.map(() => "(?,?,0)").join(","),
      rows.flatMap(({ q, id }) => [id, JSON.stringify([q.answer])]),
      c,
    );
    await query(
      "UPDATE question_papers SET status='published',published_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3),revision=revision+1 WHERE id=?",
      [paperId],
      c,
    );
    await audit(actor, "paper.publish", paperId, c);
    return {
      message:
        "Paper published. The administrator can activate the examination when its schedule is ready.",
    };
  });
}
export async function deleteDraft(actor, paperId) {
  return transaction(async (c) => {
    await lockedPaper(actor, paperId, c);
    await query("DELETE FROM question_papers WHERE id=?", [paperId], c);
    await audit(actor, "paper.delete", paperId, c);
    return { message: "Draft deleted." };
  });
}
export async function sourceFile(actor, paperId) {
  await getPaper(actor, paperId);
  const [row] = await query(
    "SELECT source_name,source_bytes FROM question_papers WHERE id=? AND examiner_id=?",
    [paperId, actor],
  );
  if (!row?.source_bytes) fail(404, "No source uploaded.");
  return row;
}
