export const $ = (selector) => document.querySelector(selector);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let csrf, csrfPromise;
export async function api(url, method = "GET", body) {
  if (method !== "GET" && !csrf) {
    csrfPromise ||= (async () => {
      const response = await fetch("/api/csrf", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.token;
    })();
    try {
      csrf = await csrfPromise;
    } catch (e) {
      csrfPromise = undefined;
      throw e;
    }
  }
  const response = await fetch("/api" + url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data.error +
        (data.fields
          ? " " + data.fields.map((f) => `${f.field}: ${f.message}`).join(" ")
          : ""),
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
export function message(text, kind = "success") {
  const box = $("#live-message");
  box.className = `alert alert-${kind} mt-3`;
  box.textContent = text;
  box.setAttribute("tabindex", "-1");
  box.focus();
}
export function localDate(value) {
  if (!value) return "—";
  return new Date(
    String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z"),
  ).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
export async function me(allowed) {
  try {
    const user = await api("/me");
    if (user.status === "pending") {
      location.href = "/verify";
      return null;
    }
    if (allowed && !allowed.includes(user.role)) {
      location.href = home(user.role);
      return null;
    }
    return user;
  } catch (e) {
    if (e.status === 401) location.href = "/login";
    else message(e.message, "danger");
    return null;
  }
}
export const home = (role) =>
  ({
    candidate: "/dashboard",
    admin: "/manage",
    invigilator: "/invigilator",
    examiner: "/examiner",
  })[role] || "/dashboard";
export function formData(form) {
  return Object.fromEntries(new FormData(form));
}
export function busy(form, value) {
  form.querySelectorAll("button").forEach((b) => (b.disabled = value));
  form.setAttribute("aria-busy", String(value));
}
export function bindForm(form, fn) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    busy(form, true);
    try {
      await fn(formData(form), form);
    } catch (error) {
      message(error.message, "danger");
    } finally {
      busy(form, false);
    }
  });
}
export function passwordField(label = "Password", name = "password") {
  return `<label class="form-label" for="${esc(name)}">${esc(label)}</label><div class="password-wrap"><input class="form-control" id="${esc(name)}" name="${esc(name)}" type="password" autocomplete="${name === "password" ? "current-password" : "new-password"}" required minlength="12" maxlength="72"><button type="button" class="toggle-password" aria-label="Show ${esc(label.toLowerCase())}">Show</button></div>`;
}
export function setupToggles() {
  document.querySelectorAll(".toggle-password").forEach(
    (button) =>
      (button.onclick = () => {
        const input = button.previousElementSibling;
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.textContent = show ? "Hide" : "Show";
        button.setAttribute("aria-label", `${show ? "Hide" : "Show"} password`);
      }),
  );
}
export function table(rows, columns, actions) {
  return `<div class="table-responsive"><table class="table table-hover"><thead><tr>${columns.map((c) => `<th scope="col">${esc(c.label || c.key)}</th>`).join("")}${actions ? '<th scope="col">Actions</th>' : ""}</tr></thead><tbody>${rows.map((row, i) => `<tr>${columns.map((c) => `<td>${esc(c.format ? c.format(row[c.key], row) : (row[c.key] ?? "—"))}</td>`).join("")}${actions ? `<td><div class="d-flex gap-2 flex-wrap">${actions(row, i)}</div></td>` : ""}</tr>`).join("") || `<tr><td colspan="${columns.length + 1}" class="text-muted py-4">No records found.</td></tr>`}</tbody></table></div>`;
}
export function button(label, action, index, style = "outline-primary") {
  return `<button class="btn btn-sm btn-${style}" type="button" data-action="${esc(action)}" data-index="${index}">${esc(label)}</button>`;
}
export function confirmDialog(title, text) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<h2 class="section-title">${esc(title)}</h2><p>${esc(text)}</p><div class="d-flex justify-content-end gap-2"><button class="btn btn-outline-secondary" data-answer="no">Cancel</button><button class="btn btn-primary" data-answer="yes">Confirm</button></div>`;
    document.body.append(dialog);
    dialog.addEventListener("cancel", () => {
      resolve(false);
      dialog.remove();
    });
    dialog.querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          resolve(b.dataset.answer === "yes");
          dialog.close();
          dialog.remove();
        }),
    );
    dialog.showModal();
  });
}
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-logout]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api("/auth/logout", "POST", {});
          location.href = "/login";
        } catch (e) {
          message(e.message, "danger");
        }
      }),
  );
  setupToggles();
});
