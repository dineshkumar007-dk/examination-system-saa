// Fresh-process startup only: no database requests or credentials are accessed.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const mode = process.argv.includes("--before") ? "before" : "after";
const samples = Array.from({ length: 3 }, () =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import { performance } from "node:perf_hooks";
    const start = performance.now();
    await import("./backend/src/app.js");
    console.log(JSON.stringify({ importMs: performance.now() - start, rssMB: process.memoryUsage().rss / 1048576 }));
  `,
      ],
      { encoding: "utf8" },
    ),
  ),
);
const result = {
  recordedAt: new Date().toISOString(),
  mode,
  samples,
  importP50ms: samples.map((s) => s.importMs).sort((a, b) => a - b)[1],
  note: "Three fresh local Node processes importing the Express application. Not a hosted cold-start or browser measurement.",
};
await mkdir("docs/performance", { recursive: true });
await writeFile(
  `docs/performance/startup-20261112-${mode}.json`,
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
