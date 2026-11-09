// Read-only managed-DB timings. Never submits real student attempts or prints identities.
import { performance } from "node:perf_hooks";
import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { query, closeDatabase } from "../backend/src/config/database.js";
import { login } from "../backend/src/services/auth.js";
const baseline = process.argv.includes("--baseline");
const result = {
  mode: baseline ? "baseline" : "after",
  recordedAt: new Date().toISOString(),
  samples: 3,
  timings: {},
  bundles: [],
};
async function measure(name, fn) {
  const values = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await fn();
    values.push(Number((performance.now() - start).toFixed(2)));
  }
  result.timings[name] = {
    ms: values,
    p50ms: values.toSorted((a, b) => a - b)[1],
  };
}
try {
  await measure("databaseRoundTrip", () => query("SELECT 1 AS ok"));
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD)
    await measure("passwordLogin", () =>
      login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, "admin"),
    );
  await measure("adminOverviewData", async () => {
    if (baseline) {
      await query(
        "SELECT id,name FROM examinations WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",
      );
      const centers = await query(
        "SELECT * FROM exam_centers ORDER BY name LIMIT 100",
      );
      await query(
        "SELECT * FROM exam_slots WHERE deleted_at IS NULL LIMIT 200",
      );
      await Promise.all(
        centers.map((c) =>
          query("SELECT * FROM computers WHERE center_id=?", [c.id]),
        ),
      );
    }
    await query(
      "SELECT (SELECT COUNT(*) FROM users WHERE role='candidate') AS candidates,(SELECT COUNT(*) FROM registrations) AS registrations,(SELECT COUNT(*) FROM exam_attempts WHERE status='in_progress') AS live_attempts,(SELECT COUNT(*) FROM notifications WHERE status='failed') AS failed_notifications",
    );
  });
  for (const file of await readdir("public/assets"))
    if (file.endsWith(".js")) {
      const bytes = await readFile("public/assets/" + file);
      result.bundles.push({
        file,
        bytes: bytes.length,
        gzipBytes: gzipSync(bytes).length,
      });
    }
  await mkdir("docs/performance", { recursive: true });
  await writeFile(
    `docs/performance/${result.mode}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closeDatabase();
}
