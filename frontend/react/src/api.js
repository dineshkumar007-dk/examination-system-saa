let csrf, adminAccess;
export function setAdminAccess(value) {
  adminAccess = value || undefined;
}
export async function api(path, method = "GET", body) {
  if (method !== "GET" && !csrf) {
    const r = await fetch("/api/csrf", { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    csrf = d.token;
  }
  const r = await fetch("/api" + path, {
    method,
    cache: "no-store",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...(adminAccess ? { "X-Admin-Access": adminAccess } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) {
    const e = new Error(
      d.error +
        (d.fields
          ? " " + d.fields.map((f) => `${f.field}: ${f.message}`).join(" ")
          : ""),
    );
    e.status = r.status;
    throw e;
  }
  return d;
}
export const home = (role) =>
  ({
    candidate: "/dashboard",
    admin: "/manage",
    invigilator: "/invigilator",
  })[role] || "/login";
export const dateText = (value) =>
  value
    ? new Date(
        String(value).replace(" ", "T") +
          (String(value).endsWith("Z") ? "" : "Z"),
      ).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "—";
export const localDate = (value) =>
  value
    ? new Date(
        String(value).replace(" ", "T") +
          (String(value).endsWith("Z") ? "" : "Z"),
      )
        .toLocaleString("sv-SE")
        .slice(0, 16)
        .replace(" ", "T")
    : "";
