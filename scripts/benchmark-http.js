// Read-only production API benchmark apart from ordinary sign-in/sign-out sessions.
// Does not create exam records, send emails, or log protected response bodies.
import "../backend/src/config/env.js";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
const baseline = process.argv.includes("--baseline"),
  origin = "https://examination-system-saa.vercel.app";
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)
  throw Error("Configure benchmark operator credentials locally.");
const cookies = new Map();
let csrf, proof;
async function call(path, method = "GET", body, expectedStatus) {
  const res = await fetch(origin + "/api" + path, {
    method,
    signal: AbortSignal.timeout(60000),
    headers: {
      Origin: origin,
      Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(proof ? { "X-Admin-Access": proof } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const value of res.headers.getSetCookie()) {
    const part = value.split(";")[0],
      at = part.indexOf("=");
    cookies.set(part.slice(0, at), part.slice(at + 1));
  }
  const data = await res.json();
  if (expectedStatus ? res.status !== expectedStatus : !res.ok)
    throw Error(
      `Benchmark ${path}: HTTP ${res.status}. Stop and inspect configuration or wait for the normal rate window.`,
    );
  return data;
}
const result = {
  mode: baseline ? "baseline" : "after",
  recordedAt: new Date().toISOString(),
  samples: 3,
  target: origin,
  note: "Real HTTP sign-in and reconstructed dashboard request path. Includes platform/network delays; no browser paint measurement.",
  loginMs: [],
  overviewWorkflowMs: [],
};
try {
  for (let i = 0; i < 3; i++) {
    csrf = (await call("/csrf")).token;
    let start = performance.now();
    const u = await call("/auth/admin-login", "POST", {
      identity: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
    proof = u.adminAccess;
    result.loginMs.push(Number((performance.now() - start).toFixed(2)));
    start = performance.now();
    if (baseline) {
      await call("/manage/examinations?limit=100");
      const [centers] = await Promise.all([
        call("/manage/centers"),
        call("/manage/slots"),
      ]);
      await Promise.all(
        centers.map((c) => call("/manage/computers?centerId=" + c.id)),
      );
    }
    await call("/manage/overview");
    result.overviewWorkflowMs.push(
      Number((performance.now() - start).toFixed(2)),
    );
    if (!baseline && i === 0) {
      await call("/examiner/papers", "GET", undefined, 403);
      await call("/examiner/papers", "POST", {}, 403);
      await call("/manage/questions", "GET", undefined, 403);
      result.adminAuthoringDenied = true;
    }
    await call("/auth/logout", "POST", {});
    proof = undefined;
  }
  result.loginP50ms = result.loginMs.toSorted((a, b) => a - b)[1];
  result.overviewP50ms = result.overviewWorkflowMs.toSorted((a, b) => a - b)[1];
  await mkdir("docs/performance", { recursive: true });
  await writeFile(
    `docs/performance/http-${result.mode}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (proof) await call("/auth/logout", "POST", {}).catch(() => {});
}
