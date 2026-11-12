import test from "node:test";
import assert from "node:assert/strict";
import { pdfFixture } from "./helpers/pdf-fixture.js";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { renderPdfPaper } from "../backend/src/services/pdf-paper.js";
import { validatePaperDocument } from "../backend/src/services/question-papers.js";

test("PDF pages render as private PNG question pages without inferred answer keys", async () => {
  const { document, images } = await renderPdfPaper(
    await pdfFixture(),
    "maths.PDF",
  );
  assert.equal(document.mode, "slides");
  assert.equal(images.length, 2);
  assert.equal(document.questions[1].prompt, "Page 2");
  assert.deepEqual(document.questions[1].slides, [2]);
  assert.equal(document.questions[0].answer, null);
  assert.equal(images[0].subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(images[0].readUInt32BE(16) <= 1600);
  assert.ok(images[0].readUInt32BE(20) <= 2000);
});

test("PDF upload rejects malformed, encrypted, excessive-page and oversized inputs", async () => {
  await assert.rejects(
    renderPdfPaper(Buffer.from("<script>bad</script>"), "bad.pdf"),
    /signature/,
  );
  await assert.rejects(
    renderPdfPaper(Buffer.alloc(3 * 1024 * 1024 + 1), "large.pdf"),
    /3 MB/,
  );
  await assert.rejects(
    renderPdfPaper(Buffer.from("%PDF-invalid"), "bad.pdf"),
    /Cannot render/,
  );
  await assert.rejects(
    renderPdfPaper(await pdfFixture({ encrypted: true }), "locked.pdf"),
    /unencrypted/,
  );
  await assert.rejects(
    renderPdfPaper(await pdfFixture({ pages: 101 }), "long.pdf"),
    /100 pages/,
  );
});

test("manual paper validation requires complete choices, an explicit key and matching marks", async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { newManualQuestion, ManualQuestionEditor } =
      await server.ssrLoadModule("/src/manual-question-editor.jsx");
    const question = newManualQuestion(1);
    question.prompt = "What is two plus two?";
    question.options.forEach((o, i) => {
      o.text = String(i + 4);
    });
    const document = {
      mode: "manual",
      questions: [question],
      issues: [],
      resolutions: {},
      slideCount: 0,
      reviewed: true,
    };
    assert.throws(() => validatePaperDocument(document, 1, true), /answer key/);
    question.answer = "A";
    assert.doesNotThrow(() => validatePaperDocument(document, 1, true));
    assert.throws(() => validatePaperDocument(document, 2, true), /add up/);
    question.options[0].text = "";
    assert.throws(() => validatePaperDocument(document, 1, true), /nonempty/);
    question.options[0].text = "Four <script>unsafe</script>";
    const html = renderToStaticMarkup(
      React.createElement(ManualQuestionEditor, {
        document,
        readonly: true,
        onChange() {},
      }),
    );
    assert.match(html, /Question text/);
    assert.match(html, /Option A/);
    assert.match(html, /Correct answer/);
    assert.doesNotMatch(html, /<script>unsafe/);
    question.slides = [1];
    assert.throws(
      () => validatePaperDocument(document, 1, true),
      /cannot reference/,
    );
  } finally {
    await server.close();
  }
});
