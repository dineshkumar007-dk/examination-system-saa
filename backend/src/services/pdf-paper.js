import { fail } from "../utils/security.js";
import { renderPdfImages } from "./pdf-render-worker.js";

export async function renderPdfPaper(buffer, filename) {
  if (
    !Buffer.isBuffer(buffer) ||
    !buffer.length ||
    buffer.length > 3 * 1024 * 1024
  )
    fail(413, "Upload a nonempty PDF no larger than 3 MB.");
  if (!filename.toLowerCase().endsWith(".pdf")) fail(415, "Upload a PDF file.");
  if (buffer.subarray(0, 5).toString() !== "%PDF-")
    fail(400, "Invalid PDF signature.");
  const images = await renderPdfImages(buffer).catch(() =>
    fail(
      422,
      "Cannot render this PDF. Use a valid, unencrypted PDF with at most 100 pages and compressed images.",
    ),
  );
  return {
    images,
    document: {
      mode: "slides",
      slideCount: images.length,
      issues: [],
      resolutions: {},
      reviewed: false,
      questions: images.map((_, i) => ({
        number: i + 1,
        prompt: `Page ${i + 1}`,
        slides: [i + 1],
        options: ["A", "B", "C", "D"].map((id) => ({ id, text: id })),
        answer: null,
        marks: 1,
        negativeMarks: 0,
        media: [],
      })),
    },
  };
}
