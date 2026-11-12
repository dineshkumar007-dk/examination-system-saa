import {
  parentPort,
  workerData,
  Worker,
  isMainThread,
} from "node:worker_threads";
import { createRequire } from "node:module";
import path from "node:path";

if (!isMainThread) {
  let task;
  try {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const require = createRequire(import.meta.url);
    const root = path
      .dirname(require.resolve("pdfjs-dist/package.json"))
      .replaceAll("\\", "/");
    task = getDocument({
      data: new Uint8Array(workerData),
      isEvalSupported: false,
      enableXfa: false,
      useSystemFonts: false,
      useWorkerFetch: false,
      stopAtErrors: true,
      verbosity: 0,
      maxImageSize: 16000000,
      cMapUrl: root + "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: root + "/standard_fonts/",
      wasmUrl: root + "/wasm/",
    });
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 100)
      throw Error("Upload 1–100 pages.");
    const images = [];
    let total = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const size = page.getViewport({ scale: 1 });
      if (
        !Number.isFinite(size.width) ||
        !Number.isFinite(size.height) ||
        size.width <= 0 ||
        size.height <= 0 ||
        size.width / size.height > 4 ||
        size.height / size.width > 4
      )
        throw Error("Unsupported page dimensions.");
      const viewport = page.getViewport({
        scale: Math.min(1600 / size.width, 2000 / size.height),
      });
      const target = pdf.canvasFactory.create(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({ canvasContext: target.context, viewport }).promise;
      const bytes = target.canvas.toBuffer("image/png");
      total += bytes.length;
      if (bytes.length > 2 * 1024 * 1024 || total > 24 * 1024 * 1024)
        throw Error("Compress the PDF images.");
      images.push(bytes);
      pdf.canvasFactory.destroy(target);
      page.cleanup();
    }
    parentPort.postMessage({ images });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  } finally {
    await task?.destroy();
  }
}

export function renderPdfImages(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: buffer,
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("PDF rendering timed out."));
    }, 35000);
    worker.once("message", (result) => {
      clearTimeout(timer);
      worker.terminate();
      if (result.error) reject(Error(result.error));
      else resolve(result.images.map((bytes) => Buffer.from(bytes)));
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(Error("PDF renderer stopped."));
    });
  });
}
