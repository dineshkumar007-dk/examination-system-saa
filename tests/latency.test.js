import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { loadWorkspaceData } from "../frontend/react/src/workspace-loader.js";

const options = {
  role: "admin",
  view: "Users",
  page: 1,
  search: "",
  selected: "",
};
test("page data starts before its lookup list finishes; catalogs remain workspace-scoped", async () => {
  const calls = [],
    references = new Map();
  const centers = Promise.withResolvers();
  const api = async (path) => {
    calls.push(path);
    return path === "/manage/centers" ? centers.promise : [{ id: "staff" }];
  };
  const pending = loadWorkspaceData({ ...options, references, api });
  assert.deepEqual(calls, [
    "/manage/centers",
    "/manage/users?page=1&limit=25&search=",
  ]);
  centers.resolve([{ id: "center" }]);
  const result = await pending;
  assert.equal(result.rows[0].id, "staff");
  assert.equal(result.catalog.centers[0].id, "center");
  calls.length = 0;
  await loadWorkspaceData({ ...options, references, api });
  assert.equal(calls.length, 1);
  references.clear();
  await loadWorkspaceData({ ...options, references, api });
  assert.equal(calls.filter((p) => p === "/manage/centers").length, 1);
});

test("catalog-only pages await their records without duplicate or staff requests", async () => {
  const calls = [],
    records = [{ id: "exam" }];
  const result = await loadWorkspaceData({
    ...options,
    role: "candidate",
    view: "Examinations",
    references: new Map(),
    api: async (path) => {
      calls.push(path);
      return records;
    },
  });
  assert.deepEqual(calls, ["/examinations?limit=100"]);
  assert.deepEqual(result.rows, records);
});

test("lookup authorization failures reject the whole page", async () => {
  await assert.rejects(
    loadWorkspaceData({
      ...options,
      references: new Map(),
      api: async (path) => {
        if (path === "/manage/centers") throw new Error("Unauthorized");
        return [];
      },
    }),
    /Unauthorized/,
  );
});

test("ordinary server startup does not initialize native slide rendering libraries", () => {
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.startsWith("@office-kit/") || specifier.endsWith("/powerpoint.js")) throw Error("Eager slide renderer: " + specifier);
      return next(specifier, context);
    } });
    await import("./backend/src/app.js");
  `,
    ],
    { cwd: new URL("../", import.meta.url), stdio: "pipe" },
  );
});

test("CSRF preparation and submission share one request and keep protection enabled", async (t) => {
  const { prepareCsrf, api } = await import(
    "../frontend/react/src/api.js?coalescing"
  );
  const token = Promise.withResolvers(),
    calls = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    calls.push({ url, opts });
    return url === "/api/csrf" ? token.promise : Response.json({ ok: true });
  });
  const prep = prepareCsrf();
  const login = api("/auth/admin-login", "POST", { identity: "test" });
  assert.equal(calls.length, 1);
  token.resolve(Response.json({ token: "signed-token" }));
  await Promise.all([prep, login]);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].opts.headers["X-CSRF-Token"], "signed-token");
  assert.equal(calls[1].opts.cache, "no-store");
});

test("a failed speculative CSRF request is retried on submission", async (t) => {
  const { prepareCsrf, api } = await import(
    "../frontend/react/src/api.js?retry"
  );
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url !== "/api/csrf") return Response.json({ ok: true });
    requests++;
    return requests === 1
      ? Response.json({ error: "Unavailable" }, { status: 503 })
      : Response.json({ token: "retry-token" });
  });
  await assert.rejects(prepareCsrf(), /Unavailable/);
  await api("/auth/login", "POST", {});
  assert.equal(requests, 2);
});

test("API errors expose the server's actual retry delay to the login screen", async (t) => {
  const { api } = await import("../frontend/react/src/api.js?rate-limit");
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: "Wait before signing in", retryAfter: 735 },
      { status: 429, headers: { "Retry-After": "735" } },
    ),
  );
  await assert.rejects(
    api("/me"),
    (error) => error.status === 429 && error.retryAfter === 735,
  );
});
