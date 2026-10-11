import { readdir, copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const all = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) all.push(...(await files(p)));
    else if (p.endsWith(".js")) all.push(p);
  }
  return all;
}
for (const dir of ["backend", "frontend", "scripts", "tests"])
  for (const file of await files(dir)) {
    const check = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (check.status !== 0) {
      console.error(check.stderr);
      process.exit(1);
    }
  }
// Vercel serves public assets directly; source remains in frontend for development.
await mkdir("public/assets/bootstrap/css", { recursive: true });
await mkdir("public/assets/bootstrap/js", { recursive: true });
for (const file of await readdir("frontend"))
  await copyFile(path.join("frontend", file), path.join("public", file));
await copyFile(
  "node_modules/bootstrap/dist/css/bootstrap.min.css",
  "public/assets/bootstrap/css/bootstrap.min.css",
);
await copyFile(
  "node_modules/bootstrap/dist/js/bootstrap.bundle.min.js",
  "public/assets/bootstrap/js/bootstrap.bundle.min.js",
);
console.log(
  "JavaScript syntax checks passed; deployment static assets generated in public/.",
);
