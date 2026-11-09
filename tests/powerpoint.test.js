import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePowerPoint,
  extractQuestions,
  MAX_UPLOAD,
} from "../backend/src/services/powerpoint.js";
import {
  validatePaperDocument,
  parseBulkKey,
} from "../backend/src/services/question-papers.js";
import { powerpointFixture } from "./helpers/powerpoint-fixture.js";
import JSZip from "jszip";
test("real generated PPTX preserves numbered questions, options, images and continuation order without guessing keys", async () => {
  const result = await parsePowerPoint(
    await powerpointFixture({ image: true, continuation: true }),
    "test.pptx",
  );
  assert.deepEqual(
    result.questions.map((q) => q.number),
    [1, 2],
  );
  assert.equal(result.questions[0].options[1].text, "Queue");
  assert.equal(result.questions[0].options[4].id, "E");
  assert.equal(result.questions[0].media[0].mime, "image/png");
  assert.ok(result.questions.every((q) => q.answer === null));
  assert.equal(result.slideCount, 3);
});
test("PowerPoint flags missing options, duplicate numbering, image-only slides and answer annotations", async () => {
  const bad = await parsePowerPoint(
    await powerpointFixture({
      malformed: true,
      duplicate: true,
      annotation: true,
    }),
    "bad.pptx",
  );
  assert.ok(bad.issues.some((i) => i.message.includes("Duplicate")));
  assert.ok(bad.issues.some((i) => i.message.includes("missing")));
  assert.ok(bad.issues.some((i) => i.message.includes("answer-like")));
  assert.ok(bad.questions.every((q) => q.answer === null));
  const scan = extractQuestions([
    { number: 1, lines: [], media: [{ mime: "image/png", data: "test" }] },
  ]);
  assert.ok(scan.issues.some((i) => i.message.includes("Image-only")));
});
test("unsafe/non-PowerPoint/oversized uploads and unavailable legacy conversion are rejected", async () => {
  for (const [data, name, status] of [
    [Buffer.from("abc"), "a.pptx", 400],
    [Buffer.from("abc"), "a.txt", 415],
    [Buffer.alloc(MAX_UPLOAD + 1), "a.pptx", 413],
    [Buffer.from("d0cf11e0a1b11ae1", "hex"), "a.ppt", 415],
  ]) {
    const previous = process.env.LIBREOFFICE_PATH;
    delete process.env.LIBREOFFICE_PATH;
    try {
      await assert.rejects(
        parsePowerPoint(data, name),
        (e) => e.status === status,
      );
    } finally {
      if (previous) process.env.LIBREOFFICE_PATH = previous;
    }
  }
});
test("macro payloads, external entities and ZIP expansion bombs are rejected", async () => {
  const bytes = await powerpointFixture();
  const macro = await JSZip.loadAsync(bytes);
  macro.file("ppt/vbaProject.bin", Buffer.from("not executable"));
  await assert.rejects(
    parsePowerPoint(
      await macro.generateAsync({ type: "nodebuffer" }),
      "macro.pptx",
    ),
    /Macros/,
  );
  const entity = await JSZip.loadAsync(bytes);
  entity.file(
    "ppt/presentation.xml",
    '<!DOCTYPE p [<!ENTITY x SYSTEM "file:///secrets">]><p/>',
  );
  await assert.rejects(
    parsePowerPoint(
      await entity.generateAsync({ type: "nodebuffer" }),
      "entity.pptx",
    ),
    /unsafe/,
  );
  const bomb = await JSZip.loadAsync(bytes);
  bomb.file("ppt/slides/oversized.xml", Buffer.alloc(11 * 1024 * 1024, 65));
  await assert.rejects(
    parsePowerPoint(
      await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
      "oversized.pptx",
    ),
    /extraction limits/,
  );
});
test("publication requires manual keys, valid totals, unique numbering and explicit slide issue resolutions", async () => {
  const doc = await parsePowerPoint(await powerpointFixture(), "paper.pptx");
  doc.reviewed = true;
  assert.throws(() => validatePaperDocument(doc, 2, true), /answer key/);
  doc.questions[0].answer = "B";
  doc.questions[1].answer = "A";
  assert.equal(validatePaperDocument(doc, 2, true).questions.length, 2);
  assert.throws(() => validatePaperDocument(doc, 3, true), /marks/);
  const duplicate = structuredClone(doc);
  duplicate.questions[1].number = 1;
  assert.throws(() => validatePaperDocument(duplicate, 2, true), /Duplicate/);
  doc.issues.push({ slide: 1, message: "Review scan" });
  assert.throws(() => validatePaperDocument(doc, 2, true), /Resolve/);
  doc.resolutions["0"] =
    "Compared against original and corrected the question.";
  assert.doesNotThrow(() => validatePaperDocument(doc, 2, true));
  assert.deepEqual(parseBulkKey("1) B\n2) A", [1, 2]), { 1: "B", 2: "A" });
  assert.throws(() => parseBulkKey("1) A\n1) B", [1]), /duplicate/);
  assert.throws(() => parseBulkKey("4) A", [1]), /Unknown/);
});
