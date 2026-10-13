import { readdir, copyFile, mkdir } from "node:fs/promises";
import { build } from "vite";
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
// Build React into the known generated workspace directory before making route shells.
await build();
const routes = [
  "login",
  "invigilator-login",
  "admin-login",
  "signup",
  "resume",
  "forgot",
  "reset",
  "verify",
  "exam-setup",
  "dashboard",
  "manage",
  "invigilator",
  "exam",
];
for (const route of routes)
  await copyFile("public/index.html", `public/${route}.html`);
// Keep Bootstrap assets for existing integrations; React uses its own stylesheet.
await mkdir("public/assets/bootstrap/css", { recursive: true });
await mkdir("public/assets/bootstrap/js", { recursive: true });
await copyFile(
  "node_modules/bootstrap/dist/css/bootstrap.min.css",
  "public/assets/bootstrap/css/bootstrap.min.css",
);
await copyFile(
  "node_modules/bootstrap/dist/js/bootstrap.bundle.min.js",
  "public/assets/bootstrap/js/bootstrap.bundle.min.js",
);
console.log(
  "JavaScript syntax checks passed; React production assets and route shells generated in public/.",
);
