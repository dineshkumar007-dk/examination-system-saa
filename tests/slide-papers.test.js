import test from "node:test";
import assert from "node:assert/strict";
import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import { renderPowerPoint } from "../backend/src/services/powerpoint.js";
import { validatePaperDocument } from "../backend/src/services/question-papers.js";

async function designedSlide() {
  const deck = new pptxgen();
  deck.layout = "LAYOUT_WIDE";
  const slide = deck.addSlide();
  slide.background = { color: "112244" };
  slide.addText("MATH CHALLENGE", {
    x: 1,
    y: 0.5,
    w: 8,
    h: 1,
    color: "FFFFFF",
  });
  slide.addText("Find the hypotenuse AC", {
    x: 1,
    y: 2,
    w: 8,
    h: 1,
    color: "FFFFFF",
  });
  slide.addShape(deck.ShapeType.rtTriangle, {
    x: 1,
    y: 3,
    w: 3,
    h: 2,
    fill: { color: "FFCC00" },
  });
  slide.addText("A", { x: 7, y: 3, w: 1, h: 0.5 });
  slide.addText("10 cm", { x: 8, y: 3, w: 2, h: 0.5 });
  slide.addNotes("PRIVATE examiner notes: correct answer A");
  return deck.write({ outputType: "nodebuffer" });
}

test("designed slides render without recognizing text and keep keys separate", async () => {
  const { document, images } = await renderPowerPoint(
    await designedSlide(),
    "geometry.pptx",
  );
  assert.equal(document.mode, "slides");
  assert.equal(document.questions.length, 1);
  assert.deepEqual(document.issues, []);
  assert.deepEqual(document.questions[0].slides, [1]);
  assert.equal(document.questions[0].answer, null);
  assert.deepEqual(
    document.questions[0].options.map((o) => o.id),
    ["A", "B", "C", "D"],
  );
  assert.equal(images[0].subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(images[0].readUInt32BE(16), 1600);
  assert.ok(!images[0].includes(Buffer.from("PRIVATE")));
  assert.ok(!JSON.stringify(document).includes("PRIVATE"));
  document.reviewed = true;
  assert.throws(() => validatePaperDocument(document, 1, true), /answer key/);
  document.questions[0].answer = "A";
  assert.doesNotThrow(() => validatePaperDocument(document, 1, true));
  document.questions[0].slides = [2];
  assert.throws(
    () => validatePaperDocument(document, 1, true),
    /valid source slide/,
  );
});

test("slide rendering rejects unsafe archives before invoking the renderer", async () => {
  const bytes = await designedSlide();
  const zip = await JSZip.loadAsync(bytes);
  zip.file("ppt/vbaProject.bin", "unsafe");
  await assert.rejects(
    renderPowerPoint(
      await zip.generateAsync({ type: "nodebuffer" }),
      "unsafe.pptx",
    ),
    /Macros/,
  );
  zip.remove("ppt/vbaProject.bin");
  zip.file(
    "ppt/slides/slide1.xml",
    '<!DOCTYPE p [<!ENTITY x SYSTEM "file:///private">]><p/>',
  );
  await assert.rejects(
    renderPowerPoint(
      await zip.generateAsync({ type: "nodebuffer" }),
      "unsafe.pptx",
    ),
    /unsafe/,
  );
});
