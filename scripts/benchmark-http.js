// Read-only production API benchmark apart from ordinary sign-in/sign-out sessions.
// Does not create exam records, send emails, or log protected response bodies.
import "../backend/src/config/env.js";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
const baseline = process.argv.includes("--baseline"),
  origin = "https://examination-system-saa.vercel.app";
const latencyBefore = process.argv.includes("--latency-before"),
  latencyAfter = process.argv.includes("--latency-after"),
  latency = latencyBefore || latencyAfter,
  paired = process.argv.includes("--navigation-paired");
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
  mode: paired
    ? "20261112-paired"
    : latency
      ? `20261112-${latencyBefore ? "before" : "after"}`
      : baseline
        ? "baseline"
        : "after",
  recordedAt: new Date().toISOString(),
  samples: paired ? 1 : 3,
  target: origin,
  note: "Real HTTP sign-in and reconstructed dashboard request path. Includes platform/network delays; no browser paint measurement.",
  loginMs: [],
  overviewWorkflowMs: [],
  ...(latency ? { usersWorkflowMs: [], csrfMs: [] } : {}),
};
try {
  for (let i = 0; i < result.samples; i++) {
    const csrfStart = performance.now();
    csrf = (await call("/csrf")).token;
    if (latency)
      result.csrfMs.push(Number((performance.now() - csrfStart).toFixed(2)));
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
    if (paired) {
      const users = () => call("/manage/users?page=1&limit=25&search=");
      const centers = () => call("/manage/centers");
      const serial = async () => {
        await centers();
        await users();
      };
      const parallel = () => Promise.all([centers(), users()]);
      // Warm both paths, then alternate ordering to reduce cold-start/order bias.
      await serial();
      await parallel();
      result.navigation = { serialMs: [], parallelMs: [], pairs: 6 };
      for (let n = 0; n < 6; n++) {
        for (const [key, fn] of n % 2
          ? [
              ["parallelMs", parallel],
              ["serialMs", serial],
            ]
          : [
              ["serialMs", serial],
              ["parallelMs", parallel],
            ]) {
          const begin = performance.now();
          await fn();
          result.navigation[key].push(
            Number((performance.now() - begin).toFixed(2)),
          );
        }
      }
      const median = (values) => {
        const s = values.toSorted((a, b) => a - b);
        return (s[2] + s[3]) / 2;
      };
      result.navigation.serialP50ms = median(result.navigation.serialMs);
      result.navigation.parallelP50ms = median(result.navigation.parallelMs);
      result.note =
        "Six warm pairs of serial (old) versus parallel (new) Users-page HTTP request scheduling in one production session, with alternating order. Includes network/platform delays; no browser paint measurement.";
    }
    if (latency) {
      start = performance.now();
      if (latencyBefore) {
        await call("/manage/centers");
        await call("/manage/users?page=1&limit=25&search=");
      } else {
        await Promise.all([
          call("/manage/centers"),
          call("/manage/users?page=1&limit=25&search="),
        ]);
      }
      result.usersWorkflowMs.push(
        Number((performance.now() - start).toFixed(2)),
      );
    }
    if (!baseline && i === 0) {
      await call("/examiner/papers", "GET", undefined, 403);
      await call("/examiner/papers", "POST", {}, 403);
      await call("/manage/questions", "GET", undefined, 403);
      result.adminAuthoringDenied = true;
      if (latencyAfter) {
        const activeProof = proof;
        try {
          proof = undefined;
          await call("/manage/overview", "GET", undefined, 401);
          result.freshAdminPageDenied = true;
        } finally {
          proof = activeProof;
        }
      }
    }
    await call("/auth/logout", "POST", {});
    proof = undefined;
  }
  result.loginP50ms = result.loginMs.toSorted((a, b) => a - b)[
    Math.floor(result.samples / 2)
  ];
  result.overviewP50ms = result.overviewWorkflowMs.toSorted((a, b) => a - b)[
    Math.floor(result.samples / 2)
  ];
  if (latency) {
    result.usersP50ms = result.usersWorkflowMs.toSorted((a, b) => a - b)[1];
    result.csrfP50ms = result.csrfMs.toSorted((a, b) => a - b)[1];
  }
  await mkdir("docs/performance", { recursive: true });
  await writeFile(
    `docs/performance/http-${result.mode}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (proof) await call("/auth/logout", "POST", {}).catch(() => {});
}
