import pptxgen from "pptxgenjs";
export async function powerpointFixture({
  image = false,
  malformed = false,
  duplicate = false,
  continuation = false,
  annotation = false,
} = {}) {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  const first = pptx.addSlide();
  first.addText("Question 1: Which data structure follows FIFO?", {
    x: 0.5,
    y: 0.3,
    w: 11,
    h: 0.5,
  });
  first.addText(
    malformed ? "A) Stack" : "A) Stack\nB) Queue\nC) Tree\nD) Graph",
    { x: 0.5, y: 1, w: 8, h: 2 },
  );
  if (annotation) first.addText("Answer: B", { x: 0.5, y: 4, w: 8, h: 0.5 });
  if (image)
    first.addImage({
      data: "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRmkAAAAASUVORK5CYII=",
      x: 9,
      y: 1,
      w: 1,
      h: 1,
    });
  if (continuation) {
    const continued = pptx.addSlide();
    continued.addText("E) Deque", { x: 0.5, y: 1, w: 8, h: 0.5 });
  }
  const second = pptx.addSlide();
  second.addText(`Question ${duplicate ? 1 : 2}: What does SQL stand for?`, {
    x: 0.5,
    y: 0.3,
    w: 11,
    h: 0.5,
  });
  second.addText(
    "A) Structured Query Language\nB) Simple Query Logic\nC) System Query Language\nD) Standard Question Language",
    { x: 0.5, y: 1, w: 10, h: 3 },
  );
  return pptx.write({ outputType: "nodebuffer" });
}
