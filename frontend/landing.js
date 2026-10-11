import { $, api, esc, localDate, message } from "./common.js";
try {
  const exams = await api("/examinations");
  $("#exam-list").innerHTML =
    exams
      .map(
        (e) =>
          `<div class="col-md-6 col-lg-4"><article class="card h-100"><div class="card-body"><span class="badge-soft">${esc(e.status)}</span><h3 class="h5 mt-3">${esc(e.name)}</h3><p class="text-muted">${esc(e.description)}</p><div class="form-help">${e.duration_minutes} minutes · ${Number(e.fee) > 0 ? "₹" + esc(e.fee) + " simulated fee" : "No fee"}</div><p class="form-help mt-2">Registration ends ${esc(localDate(e.registration_end))}</p><a class="btn btn-outline-primary" href="/signup">Register account</a></div></article></div>`,
      )
      .join("") ||
    '<div class="col"><div class="status-box">No examinations have been announced yet. Check back after the authority opens registration.</div></div>';
} catch (e) {
  $("#exam-list").textContent =
    "Examination listings are currently unavailable.";
  message(e.message, "danger");
}
