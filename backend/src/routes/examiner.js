import { Router, raw, json } from "express";
import { z } from "zod";
import { id } from "../utils/validation.js";
import { throttle } from "../middleware/security.js";
import * as papers from "../services/question-papers.js";
const router = Router();
const revision = z.number().int().positive();
router.get("/examinations", async (req, res) =>
  res.json(await papers.assignedExaminations(req.user.id)),
);
router.get("/papers", async (req, res) =>
  res.json(
    await papers.listPapers(
      req.user.id,
      z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .default(1)
        .parse(req.query.page),
      z.enum(["draft", "published"]).optional().parse(req.query.status),
    ),
  ),
);
router.post("/papers", json({ limit: "32kb" }), async (req, res) => {
  const { examId, authoringMode = "upload", ...data } = req.body;
  res
    .status(201)
    .json(
      await papers.createPaper(
        req.user.id,
        id.parse(examId),
        data,
        z.enum(["upload", "manual"]).parse(authoringMode),
      ),
    );
});
router.get("/papers/:id", async (req, res) =>
  res.json(await papers.getPaper(req.user.id, id.parse(req.params.id))),
);
router.put("/papers/:id", json({ limit: "2mb" }), async (req, res) => {
  const { expectedRevision, document, ...data } = req.body;
  res.json(
    await papers.savePaper(
      req.user.id,
      id.parse(req.params.id),
      revision.parse(expectedRevision),
      data,
      document,
    ),
  );
});
router.delete("/papers/:id", async (req, res) =>
  res.json(await papers.deleteDraft(req.user.id, id.parse(req.params.id))),
);
router.post(
  "/papers/:id/upload",
  throttle("paper-upload", 10, 3600),
  raw({
    type: [
      "application/octet-stream",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
      "application/pdf",
    ],
    limit: "3mb",
  }),
  async (req, res) => {
    const filename = z
      .string()
      .min(5)
      .max(200)
      .parse(req.query.filename)
      .replace(/[^a-zA-Z0-9_. -]/g, "_");
    res.json(
      await papers.uploadPaper(
        req.user.id,
        id.parse(req.params.id),
        revision.parse(Number(req.query.revision)),
        req.body,
        filename,
      ),
    );
  },
);
router.post("/papers/:id/key", async (req, res) => {
  const paper = await papers.getPaper(req.user.id, id.parse(req.params.id));
  const doc =
    typeof paper.document === "string"
      ? JSON.parse(paper.document)
      : paper.document;
  res.json(
    papers.parseBulkKey(
      z.string().max(10000).parse(req.body.text),
      doc.questions.map((q) => q.number),
    ),
  );
});
router.post(
  "/papers/:id/render",
  throttle("paper-upload", 10, 3600),
  async (req, res) => {
    const paperId = id.parse(req.params.id);
    const source = await papers.sourceFile(req.user.id, paperId);
    res.json(
      await papers.uploadPaper(
        req.user.id,
        paperId,
        revision.parse(req.body.expectedRevision),
        source.source_bytes,
        source.source_name,
      ),
    );
  },
);
router.get("/papers/:id/slides/:number", async (req, res) => {
  const image = await papers.slideImage(
    req.user.id,
    id.parse(req.params.id),
    z.coerce.number().int().min(1).max(300).parse(req.params.number),
  );
  res.type("png").send(image);
});
router.post("/papers/:id/publish", async (req, res) =>
  res.json(
    await papers.publishPaper(
      req.user.id,
      id.parse(req.params.id),
      revision.parse(req.body.expectedRevision),
    ),
  ),
);
router.get("/papers/:id/source", async (req, res) => {
  const row = await papers.sourceFile(req.user.id, id.parse(req.params.id));
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${row.source_name.replace(/[^a-zA-Z0-9_. -]/g, "_")}"`,
  });
  res.send(row.source_bytes);
});
export { router as examinerRouter };
