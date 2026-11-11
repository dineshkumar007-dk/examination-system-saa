import {
  parentPort,
  workerData,
  Worker,
  isMainThread,
} from "node:worker_threads";
import { loadPresentation, getSlides, getSlideSize } from "@office-kit/pptx";
import { renderSlideToImage } from "@office-kit/pptx-preview/node";

if (!isMainThread) {
  try {
    const presentation = await loadPresentation(new Uint8Array(workerData));
    const size = getSlideSize(presentation);
    if (
      !size.width ||
      !size.height ||
      size.width / size.height > 4 ||
      size.height / size.width > 4
    )
      throw new Error("Unsupported slide dimensions.");
    let total = 0;
    const images = getSlides(presentation).map((slide) => {
      const image = renderSlideToImage(presentation, slide, { width: 1600 });
      total += image.length;
      if (image.length > 2 * 1024 * 1024 || total > 24 * 1024 * 1024)
        throw new Error(
          "Slide images are too large. Compress the presentation.",
        );
      return image;
    });
    parentPort.postMessage({ images });
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
}

export function renderSlideImages(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: buffer,
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          "Slide rendering timed out. Split the presentation into a smaller paper.",
        ),
      );
    }, 35000);
    worker.once("message", (result) => {
      clearTimeout(timer);
      worker.terminate();
      if (result.error) reject(new Error(result.error));
      else resolve(result.images.map((bytes) => Buffer.from(bytes)));
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new Error("Slide rendering stopped. Try a smaller presentation."),
        );
    });
  });
}
