import {
  $,
  api,
  esc,
  me,
  localDate,
  message,
  bindForm,
  table,
  button,
  confirmDialog,
} from "./common.js";
const role = {
  dashboard: "candidate",
  manage: "admin",
  invigilator: "invigilator",
  examiner: "examiner",
}[document.body.dataset.page];
const user = await me([role]);
let view,
  rows = [],
  page = 1,
  search = "",
  catalog = {},
  selectedCenter = "",
  selectedBank = "";
const menus = {
  candidate: [
    "Overview",
    "Examinations",
    "My registrations",
    "Profile",
    "Notifications",
  ],
  admin: [
    "Overview",
    "Examinations",
    "Centers",
    "Computers",
    "Slots",
    "Registrations",
    "Users",
    "Questions",
    "Invigilator",
    "Results",
    "Notifications",
    "Audit",
  ],
  invigilator: ["Invigilator", "Workstations"],
  examiner: ["Questions", "Examinations"],
};
function queryString() {
  return `?page=${page}&search=${encodeURIComponent(search)}`;
}
async function catalogs() {
  catalog.exams =
    role === "invigilator"
      ? []
      : await api(
          role === "candidate"
            ? "/examinations"
            : "/manage/examinations?limit=100",
        );
  if (["admin", "invigilator"].includes(role)) {
    catalog.centers = await api("/manage/centers");
    catalog.slots = await api("/manage/slots");
  }
}
const optionList = (items, label = "name") =>
  items.map((r) => ({ value: r.id, label: r[label] || r.id }));
const field = (name, label, type = "text", options, help) => ({
  name,
  label,
  type,
  options,
  help,
});
function renderForm(title, fields, values = {}, save) {
  const dialog = document.createElement("dialog");
  dialog.style.width = "min(760px,94vw)";
  dialog.innerHTML = `<h2 class="section-title">${esc(title)}</h2><form id="record-form">${fields.map((f) => `<div class="mb-3"><label class="form-label" for="f-${esc(f.name)}">${esc(f.label)}</label>${f.type === "select" ? `<select id="f-${esc(f.name)}" name="${esc(f.name)}" class="form-select" required>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(values[f.name]) === String(o.value) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>` : f.type === "textarea" ? `<textarea id="f-${esc(f.name)}" name="${esc(f.name)}" class="form-control" rows="3" required>${esc(values[f.name] ?? "")}</textarea>` : `<input id="f-${esc(f.name)}" name="${esc(f.name)}" class="form-control" type="${f.type}" ${f.type === "number" ? 'step="any" min="0"' : ""} value="${esc(values[f.name] ?? "")}" required>`}${f.help ? `<p class="form-help mt-1">${esc(f.help)}</p>` : ""}</div>`).join("")}<p id="dialog-error" class="text-danger" role="alert"></p><div class="d-flex justify-content-end gap-2"><button type="button" class="btn btn-outline-secondary" data-close>Cancel</button><button type="submit" class="btn btn-primary">Save</button></div></form>`;
  document.body.append(dialog);
  dialog.querySelector("[data-close]").onclick = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.addEventListener("cancel", () => dialog.remove());
  const form = dialog.querySelector("form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const b = form.querySelector("[type=submit]");
    b.disabled = true;
    try {
      const result = await save(Object.fromEntries(new FormData(form)));
      dialog.close();
      dialog.remove();
      message(
        result?.message || "Saved successfully.",
        result?.emailStatus === "queued" ? "warning" : "success",
      );
      await load(view);
    } catch (error) {
      dialog.querySelector("#dialog-error").textContent = error.message;
      b.disabled = false;
    }
  };
  dialog.showModal();
}
const boolOptions = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];
function toolbar(add) {
  return `<div class="d-flex flex-wrap justify-content-between gap-3 mb-3"><form id="search-form" class="d-flex gap-2"><label class="visually-hidden" for="search-input">Search</label><input class="form-control" id="search-input" name="search" placeholder="Search records" value="${esc(search)}"><button class="btn btn-outline-primary">Search</button></form>${add ? `<button class="btn btn-primary" id="add-record">${esc(add)}</button>` : ""}</div>`;
}
function bindToolbar(add) {
  if ($("#search-form"))
    bindForm($("#search-form"), async (d) => {
      search = d.search;
      page = 1;
      await load(view);
    });
  if (add && $("#add-record")) $("#add-record").onclick = add;
}
function pagination() {
  return `<div class="d-flex gap-3 align-items-center mt-3"><button class="btn btn-outline-secondary btn-sm" id="prev-page" ${page === 1 ? "disabled" : ""}>Previous</button><span class="form-help">Page ${page}</span><button class="btn btn-outline-secondary btn-sm" id="next-page" ${rows.length < 25 ? "disabled" : ""}>Next</button></div>`;
}
function bindPagination() {
  if ($("#prev-page"))
    $("#prev-page").onclick = () => {
      page--;
      load(view);
    };
  if ($("#next-page"))
    $("#next-page").onclick = () => {
      page++;
      load(view);
    };
}
function bindActions(fn) {
  document.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await fn(b.dataset.action, rows[Number(b.dataset.index)]);
        } catch (e) {
          message(e.message, "danger");
        } finally {
          b.disabled = false;
        }
      }),
  );
}
const dateInput = (value) => {
  const d = new Date(value.replace(" ", "T") + "Z");
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const cols = (...keys) =>
  keys.map((key) => ({
    key,
    label: key.replaceAll("_", " "),
    ...(/(_at|start|end)$/.test(key) ? { format: localDate } : {}),
  }));
async function load(next) {
  view = next;
  $("#view-title").textContent = view;
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("selected", b.dataset.view === view));
  const target = $("#view-content");
  target.innerHTML = '<p role="status">Loading records…</p>';
  try {
    await catalogs();
    await render(target);
  } catch (e) {
    target.innerHTML =
      '<div class="status-box">This view is unavailable until its services are configured.</div>';
    message(e.message, "danger");
  }
}
async function render(target) {
  if (view === "Overview") {
    if (role === "admin") {
      const stats = await api("/manage/overview");
      target.innerHTML =
        '<div class="row g-4">' +
        Object.entries(stats)
          .map(
            ([k, v]) =>
              `<div class="col-sm-6 col-xl-3"><div class="card"><div class="card-body"><p class="min-label">${esc(k.replaceAll("_", " ").toUpperCase())}</p><div class="metric">${esc(v)}</div></div></div></div>`,
          )
          .join("") +
        '</div><div class="center-note mt-4">Create an examination and question set, open registration, close registration, allocate slots, then activate the examination. Evaluate completed attempts and publish results separately.</div>';
    } else {
      const regs = await api("/registrations/mine");
      const profile = await api("/profile");
      target.innerHTML = `<div class="card"><div class="card-body"><span class="badge-soft">Email verified</span><h2 class="h3 mt-3">Welcome, ${esc(user.name.split(" ")[0])}.</h2><p class="text-muted">Manage your applications and prepare for examination day.</p><div class="row mt-4"><div class="col"><div class="metric">${regs.length}</div><p class="text-muted">Applications</p></div><div class="col"><div class="metric">${regs.filter((r) => r.allocation_id).length}</div><p class="text-muted">Center allocations</p></div><div class="col"><div class="metric">${regs.filter((r) => r.result_status === "Published").length}</div><p class="text-muted">Published results</p></div></div>${profile.selected_exam_id && !regs.some((r) => r.exam_id === profile.selected_exam_id) ? '<button class="btn btn-primary" id="selected-exam">Complete registration for your selected examination</button>' : ""}</div></div><div class="center-note mt-4">Download your hall ticket when it is ready. Examination access requires your assigned center, slot, verified attendance and enrolled workstation.</div>`;
      if ($("#selected-exam"))
        $("#selected-exam").onclick = async () => {
          try {
            await api("/registrations", "POST", {
              examId: profile.selected_exam_id,
            });
            message("Registration created.");
            await load("My registrations");
          } catch (e) {
            message(e.message, "danger");
          }
        };
    }
    return;
  }
  if (view === "Profile") {
    const p = await api("/profile");
    target.innerHTML = `<div class="card"><div class="card-body"><p><strong>Email:</strong> ${esc(p.email)} <span class="badge-soft">Verified</span></p><p><strong>Mobile:</strong> ${esc(p.phone)} <span class="badge-soft">Verified</span></p><p><strong>Date of birth:</strong> ${esc(p.dob)}</p><form id="profile-form"><label class="form-label" for="name">Full name</label><input id="name" name="name" class="form-control mb-3" value="${esc(p.name)}" required><label class="form-label" for="address">Address</label><textarea id="address" name="address" class="form-control mb-3" required>${esc(p.address)}</textarea><button class="btn btn-primary">Save profile</button></form><p class="form-help mt-3">Contact changes require examination authority assistance to preserve verified identity.</p></div></div>`;
    bindForm($("#profile-form"), async (d) => {
      await api("/profile", "PATCH", d);
      message("Profile updated.");
    });
    return;
  }
  if (view === "Examinations" && role === "candidate") {
    rows = catalog.exams;
    target.innerHTML =
      '<div class="row g-4">' +
        rows
          .map(
            (e, i) =>
              `<div class="col-lg-6"><div class="card h-100"><div class="card-body"><span class="badge-soft">${esc(e.status)}</span><h2 class="h5 mt-3">${esc(e.name)}</h2><p class="text-muted">${esc(e.description)}</p><p class="form-help">${e.duration_minutes} minutes · ${e.fee > 0 ? "₹" + e.fee + " simulation only" : "No fee"}<br>Registration ends ${esc(localDate(e.registration_end))}</p>${e.status === "open" ? button("Register for examination", "register", i) : ""}</div></div></div>`,
          )
          .join("") || "<p>No examinations available.</p>";
    bindActions(async (a, r) => {
      if (
        await confirmDialog(
          "Register for examination?",
          `Submit an application for ${r.name}?`,
        )
      ) {
        await api("/registrations", "POST", { examId: r.id });
        message("Registration created.");
        await load("My registrations");
      }
    });
    return;
  }
  if (view === "My registrations") {
    rows = await api("/registrations/mine");
    target.innerHTML =
      rows
        .map(
          (r, i) =>
            `<article class="card mb-3"><div class="card-body"><div class="d-flex justify-content-between gap-3 flex-wrap"><h2 class="h5">${esc(r.exam_name)}</h2><span class="badge-soft">${esc(r.status)}</span></div><p class="mono">${esc(r.registration_number)}<br>${esc(r.application_number)}</p>${r.payment_status ? `<p>Payment: ${esc(r.payment_status)} · ₹${esc(r.amount)} · <strong>Simulation only, no money collected</strong></p>${r.payment_status !== "Successful" ? button("Simulate successful payment", "pay", i) + " " + button("Simulate failed payment", "fail-pay", i, "outline-secondary") : ""}` : ""}${r.allocation_id ? `<div class="status-box mt-3"><strong>${esc(r.center_name)}</strong><p>${esc(r.center_address)}<br>${esc(localDate(r.starts_at))} — ${esc(localDate(r.ends_at))}</p><p class="mono">Hall ticket: ${esc(r.hall_number)}</p><p>Attendance: ${esc(r.attendance)} · Computer: ${esc(r.computer_label || "Not assigned")}<br>Exam password: ${r.exam_password_set ? "Set" : "Use your emailed setup link"}</p><a class="btn btn-outline-primary btn-sm" href="/api/hall-ticket/${esc(r.allocation_id)}">Download hall ticket PDF</a></div>` : '<p class="text-muted">Your center, slot and hall ticket will appear after allocation.</p>'}${r.attempt_status === "submitted" ? `<div class="alert alert-success mt-3">Your examination has been submitted successfully. Your responses have been recorded.</div>` : ""}${r.result_status === "Published" ? `<p><strong>Published score: ${esc(r.score)}</strong></p>` : r.attempt_status === "submitted" ? '<p class="text-muted">Results will be announced by the examination authority.</p>' : ""}</div></article>`,
        )
        .join("") ||
      '<div class="status-box">No applications yet. Select an examination to register.</div>';
    bindActions(async (a, r) => {
      if (
        await confirmDialog(
          "Simulate payment?",
          "This is an academic simulation. No payment gateway or bank transaction is involved.",
        )
      ) {
        await api("/payments/simulate", "POST", {
          registrationId: r.id,
          outcome: a === "pay" ? "Successful" : "Failed",
        });
        message("Simulated payment saved.");
        await load(view);
      }
    });
    return;
  }
  if (view === "Examinations") {
    rows = await api("/manage/examinations" + queryString());
    target.innerHTML =
      toolbar(role === "admin" ? "Create examination" : null) +
      table(
        rows,
        cols(
          "name",
          "status",
          "duration_minutes",
          "fee",
          "registration_start",
          "registration_end",
        ),
        role === "admin"
          ? (r, i) =>
              button("Edit", "edit", i) +
              (["draft", "open", "closed"].includes(r.status)
                ? button("Delete", "delete", i, "outline-danger")
                : "")
          : null,
      ) +
      pagination();
    bindPagination();
    const fields = [
      field("name", "Examination name"),
      field("description", "Description", "textarea"),
      field("instructions", "Instructions", "textarea"),
      field("durationMinutes", "Duration (minutes)", "number"),
      field("registrationStart", "Registration starts", "datetime-local"),
      field("registrationEnd", "Registration ends", "datetime-local"),
      field("fee", "Simulated fee (₹)", "number"),
      field(
        "status",
        "Status",
        "select",
        ["draft", "open", "closed", "active", "completed"].map((v) => ({
          value: v,
          label: v,
        })),
      ),
    ];
    const edit = (r) =>
      renderForm(
        r ? "Edit examination" : "Create examination",
        fields.map((f) =>
          f.name === "status"
            ? {
                ...f,
                options: (r
                  ? {
                      draft: ["draft", "open"],
                      open: ["open", "closed"],
                      closed: ["closed", "active"],
                      active: ["active", "completed"],
                      completed: ["completed"],
                    }[r.status]
                  : ["draft", "open"]
                ).map((value) => ({ value, label: value })),
              }
            : f,
        ),
        r
          ? {
              ...r,
              durationMinutes: r.duration_minutes,
              registrationStart: dateInput(r.registration_start),
              registrationEnd: dateInput(r.registration_end),
            }
          : { durationMinutes: 180, fee: 0, status: "draft" },
        async (d) => {
          d.registrationStart = new Date(d.registrationStart).toISOString();
          d.registrationEnd = new Date(d.registrationEnd).toISOString();
          await api(
            "/manage/examinations" + (r ? "/" + r.id : ""),
            r ? "PUT" : "POST",
            d,
          );
        },
      );
    bindToolbar(() => edit());
    bindActions(async (a, r) => {
      if (a === "edit") edit(r);
      else if (
        await confirmDialog(
          "Delete examination?",
          `${r.name}: This permanently removes the examination, its questions and unused slots. Examinations with student registrations cannot be deleted; edit their schedule instead.`,
        )
      ) {
        await api("/manage/examinations/" + r.id, "DELETE");
        await load(view);
      }
    });
    return;
  }
  if (view === "Centers") {
    rows = await api("/manage/centers");
    target.innerHTML =
      toolbar("Add center") +
      table(
        rows,
        cols("name", "city", "state", "capacity", "active"),
        (r, i) =>
          button("Edit", "edit", i) +
          button("Delete", "delete", i, "outline-danger"),
      );
    const fields = [
      field("name", "Center name"),
      field("address", "Address", "textarea"),
      field("city", "City"),
      field("state", "State"),
      field("capacity", "PC capacity", "number"),
      field("active", "Active", "select", boolOptions),
    ];
    const edit = (r) =>
      renderForm(
        r ? "Edit center" : "Add center",
        fields,
        r ? { ...r, active: !!r.active } : { active: true },
        async (d) => {
          d.active = d.active === "true";
          await api(
            "/manage/centers" + (r ? "/" + r.id : ""),
            r ? "PUT" : "POST",
            d,
          );
        },
      );
    bindToolbar(() => edit());
    bindActions(async (a, r) => {
      if (a === "edit") edit(r);
      else if (await confirmDialog("Delete unused center?", r.name)) {
        await api("/manage/centers/" + r.id, "DELETE");
        await load(view);
      }
    });
    return;
  }
  if (view === "Computers") {
    target.innerHTML = `<div class="card mb-3"><div class="card-body"><label class="form-label" for="center-select">Center</label><select class="form-select" id="center-select"><option value="">Choose a center</option>${catalog.centers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></div></div><div id="computer-table"></div>`;
    $("#center-select").onchange = async () => {
      const centerId = $("#center-select").value;
      selectedCenter = centerId;
      if (!centerId) return;
      rows = await api("/manage/computers?centerId=" + centerId);
      $("#computer-table").innerHTML =
        '<button class="btn btn-primary mb-3" id="add-pc">Add computer</button>' +
        table(rows, cols("label", "active"), (r, i) =>
          button(r.active ? "Deactivate" : "Activate", "toggle", i),
        );
      $("#add-pc").onclick = () =>
        renderForm(
          "Add computer",
          [field("label", "Computer label")],
          {},
          async (d) => api("/manage/computers", "POST", { ...d, centerId }),
        );
      bindActions(async (a, r) => {
        await api("/manage/computers/" + r.id, "PATCH", { active: !r.active });
        message("Computer updated.");
        await load(view);
      });
    };
    if (
      selectedCenter &&
      catalog.centers.some((c) => c.id === selectedCenter)
    ) {
      $("#center-select").value = selectedCenter;
      await $("#center-select").onchange();
    }
    return;
  }
  if (view === "Slots") {
    rows = catalog.slots;
    target.innerHTML =
      toolbar("Create slot") +
      table(
        rows,
        cols(
          "exam_name",
          "center_name",
          "starts_at",
          "ends_at",
          "capacity",
          "allocated",
        ),
        (r, i) => button("Delete unused", "delete", i, "outline-danger"),
      );
    bindToolbar(() =>
      renderForm(
        "Create examination slot",
        [
          field(
            "examId",
            "Examination",
            "select",
            catalog.exams.map((e) => ({
              value: e.id,
              label: `${e.name} · ${e.duration_minutes} minutes minimum`,
            })),
          ),
          field(
            "centerId",
            "Center",
            "select",
            catalog.centers
              .filter((c) => c.active)
              .map((c) => ({
                value: c.id,
                label: `${c.name} · capacity ${c.capacity}`,
              })),
          ),
          field("startsAt", "Starts (your local timezone)", "datetime-local"),
          field("endsAt", "Ends (your local timezone)", "datetime-local"),
          field("capacity", "Candidate capacity", "number"),
        ],
        {},
        async (d) => {
          d.startsAt = new Date(d.startsAt).toISOString();
          d.endsAt = new Date(d.endsAt).toISOString();
          await api("/manage/slots", "POST", d);
        },
      ),
    );
    bindActions(async (a, r) => {
      if (await confirmDialog("Delete unused slot?", r.exam_name)) {
        await api("/manage/slots/" + r.id, "DELETE");
        await load(view);
      }
    });
    return;
  }
  if (view === "Registrations") {
    rows = await api("/manage/registrations" + queryString());
    target.innerHTML =
      '<p class="text-muted">Before allocating a slot, close the examination registration under Examinations → Edit → Status: Closed.</p>' +
      toolbar() +
      table(
        rows,
        cols(
          "name",
          "email",
          "exam_name",
          "registration_number",
          "status",
          "payment_status",
          "hall_number",
        ),
        (r, i) =>
          r.allocation_id
            ? button("Reissue credentials email", "activate", i)
            : r.status === "completed"
              ? button("Allocate slot", "allocate", i)
              : "",
      ) +
      pagination();
    bindToolbar();
    bindPagination();
    bindActions(async (a, r) => {
      if (a === "activate") {
        if (
          !(await confirmDialog(
            "Reissue examination credentials?",
            "A new examination password will be emailed to this candidate. Their previous examination password and setup link will stop working.",
          ))
        )
          return;
        const result = await api(
          "/manage/activation/" + r.allocation_id,
          "POST",
          {},
        );
        message(
          result.message,
          result.emailStatus === "queued" ? "warning" : "success",
        );
      } else
        renderForm(
          "Allocate " + r.name,
          [
            field(
              "slotId",
              "Matching future slot",
              "select",
              catalog.slots
                .filter((s) => s.exam_id === r.exam_id)
                .map((s) => ({
                  value: s.id,
                  label: `${s.center_name} · ${localDate(s.starts_at)} · ${s.allocated}/${s.capacity}`,
                })),
            ),
          ],
          {},
          async (d) =>
            api("/manage/allocate", "POST", { registrationId: r.id, ...d }),
        );
    });
    return;
  }
  if (view === "Users") {
    rows = await api("/manage/users" + queryString());
    target.innerHTML =
      toolbar("Create staff account") +
      table(rows, cols("name", "email", "role", "status"), (r, i) =>
        r.role !== "admin"
          ? button("Edit access", "edit", i) +
            button("Delete", "delete", i, "outline-danger")
          : "",
      ) +
      pagination();
    bindPagination();
    const centerOptions = [
      { value: "", label: "No center" },
      ...optionList(catalog.centers),
    ];
    bindToolbar(() =>
      renderForm(
        "Create staff",
        [
          field("name", "Full name"),
          field("email", "Email", "email"),
          field("role", "Staff role", "select", [
            { value: "invigilator", label: "Invigilator" },
            { value: "examiner", label: "Examiner" },
          ]),
          field("centerId", "Assigned center", "select", centerOptions),
          field(
            "password",
            "Login password (at least 12 characters)",
            "password",
          ),
          field("confirmPassword", "Confirm login password", "password"),
        ],
        {},
        async (d) => {
          if (d.password !== d.confirmPassword)
            throw new Error("Passwords must match.");
          d.centerId = d.centerId || null;
          await api("/manage/staff", "POST", d);
        },
      ),
    );
    bindActions(async (a, r) => {
      if (a === "delete") {
        if (
          await confirmDialog(
            "Delete user?",
            `${r.name} (${r.email}) will lose access immediately. Unused accounts are permanently deleted from the database. Accounts with exam registrations retain their exam records, but their email and mobile are released for reuse. Sessions and device grants issued by this user will be revoked.`,
          )
        ) {
          const result = await api("/manage/users/" + r.id, "DELETE");
          message(result.message);
          await load(view);
        }
        return;
      }
      renderForm(
        "Edit access for " + r.name,
        [
          field(
            "role",
            "Role",
            "select",
            ["candidate", "invigilator", "examiner"].map((v) => ({
              value: v,
              label: v,
            })),
          ),
          field("status", "Status", "select", [
            { value: "active", label: "Active" },
            { value: "disabled", label: "Disabled" },
          ]),
          field("centerId", "Assigned center", "select", centerOptions),
        ],
        { ...r, centerId: r.center_id || "" },
        async (d) => {
          d.centerId = d.centerId || null;
          await api("/manage/users/" + r.id, "PATCH", d);
        },
      );
    });
    return;
  }
  if (view === "Questions") {
    target.innerHTML = `<label class="form-label" for="exam-select">Question bank / examination</label><select class="form-select mb-3" id="exam-select"><option value="">Choose an examination</option>${catalog.exams.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join("")}</select><div id="question-table"></div>`;
    $("#exam-select").onchange = async () => {
      const examId = $("#exam-select").value;
      selectedBank = examId;
      if (!examId) return;
      rows = await api("/manage/questions?examId=" + examId);
      $("#question-table").innerHTML =
        '<button class="btn btn-primary mb-3" id="add-question">Add question</button>' +
        table(
          rows,
          cols("position", "type", "prompt", "marks", "negative_marks"),
          (r, i) =>
            button("Edit", "edit", i) +
            button("Delete", "delete", i, "outline-danger"),
        );
      const fields = [
        field(
          "type",
          "Question type",
          "select",
          ["MCQ", "MSQ", "NAT"].map((v) => ({ value: v, label: v })),
        ),
        field("prompt", "Question text", "textarea"),
        field(
          "options",
          "Options (one per line: A|Option text; use none for NAT)",
          "textarea",
        ),
        field("key", "Answer key (A for MCQ, A,B for MSQ, a number for NAT)"),
        field("tolerance", "NAT tolerance", "number"),
        field("marks", "Marks", "number"),
        field("negativeMarks", "Negative marks", "number"),
        field("position", "Question number", "number"),
      ];
      const edit = (r) =>
        renderForm(
          r ? "Edit question" : "Add question",
          fields,
          r
            ? {
                ...r,
                options:
                  r.options.map((o) => o.id + "|" + o.text).join("\n") ||
                  "none",
                key: Array.isArray(r.correct_answer)
                  ? r.correct_answer.join(",")
                  : r.correct_answer,
                negativeMarks: r.negative_marks,
              }
            : {
                type: "MCQ",
                options: "A|\nB|\nC|\nD|",
                marks: 1,
                negativeMarks: 0,
                tolerance: 0,
                position: rows.length + 1,
              },
          async (d) => {
            const payload = {
              examId,
              type: d.type,
              prompt: d.prompt,
              options:
                d.type === "NAT"
                  ? []
                  : d.options
                      .split("\n")
                      .filter(Boolean)
                      .map((line) => {
                        const at = line.indexOf("|");
                        return {
                          id: line.slice(0, at).trim(),
                          text: line.slice(at + 1).trim(),
                        };
                      }),
              correctAnswer:
                d.type === "NAT"
                  ? Number(d.key)
                  : d.key.split(",").map((v) => v.trim()),
              tolerance: Number(d.tolerance),
              marks: Number(d.marks),
              negativeMarks: Number(d.negativeMarks),
              position: Number(d.position),
            };
            await api(
              "/manage/questions" + (r ? "/" + r.id : ""),
              r ? "PUT" : "POST",
              payload,
            );
          },
        );
      $("#add-question").onclick = () => edit();
      bindActions(async (a, r) => {
        if (a === "edit") edit(r);
        else if (await confirmDialog("Delete question?", r.prompt)) {
          await api("/manage/questions/" + r.id, "DELETE");
          await load(view);
        }
      });
    };
    if (selectedBank && catalog.exams.some((e) => e.id === selectedBank)) {
      $("#exam-select").value = selectedBank;
      await $("#exam-select").onchange();
    }
    return;
  }
  if (view === "Invigilator") {
    rows = await api("/invigilator/candidates" + queryString());
    target.innerHTML =
      '<p class="text-muted">Inspect physical identification and confirm the allocated center and slot before marking a candidate verified.</p>' +
      toolbar() +
      table(
        rows,
        cols(
          "name",
          "registration_number",
          "hall_number",
          "starts_at",
          "attendance",
          "computer_label",
          "attempt_status",
        ),
        (r, i) =>
          !["Exam Started", "Exam Submitted"].includes(r.attendance)
            ? button("Attendance / assign PC", "verify", i)
            : "",
      ) +
      pagination();
    bindToolbar();
    bindPagination();
    bindActions(async (a, r) => {
      const pcs = await api("/manage/computers?centerId=" + r.center_id);
      renderForm(
        "Verify " + r.name,
        [
          field(
            "attendance",
            "Attendance",
            "select",
            ["Present", "Verified", "Absent"].map((v) => ({
              value: v,
              label: v,
            })),
          ),
          field("computerId", "Computer (required for Verified)", "select", [
            { value: "", label: "No computer" },
            ...optionList(
              pcs.filter((p) => p.active),
              "label",
            ),
          ]),
          field(
            "identityChecked",
            "I inspected physical ID and matched candidate, center and slot",
            "select",
            boolOptions,
          ),
        ],
        { attendance: "Present", identityChecked: false },
        async (d) =>
          api("/invigilator/verify", "POST", {
            allocationId: r.id,
            attendance: d.attendance,
            computerId: d.computerId || null,
            identityChecked: d.identityChecked === "true",
          }),
      );
    });
    return;
  }
  if (view === "Workstations") {
    target.innerHTML =
      '<div class="center-note mb-4">Open this screen on the actual authorized workstation. Grant exam access to this device for its computer label and slot, then sign out before the assigned candidate signs in. Browser credentials require supervised kiosks and endpoint controls for physical security.</div><button class="btn btn-primary" id="enroll">Grant exam access to this device</button>';
    $("#enroll").onclick = async () => {
      try {
        if (!catalog.slots.length)
          throw new Error("No slots are assigned to your center.");
        const pcs = await api(
          "/manage/computers?centerId=" + catalog.slots[0].center_id,
        );
        renderForm(
          "Grant access to this exam device",
          [
            field(
              "slotId",
              "Slot",
              "select",
              catalog.slots.map((s) => ({
                value: s.id,
                label: s.exam_name + " · " + localDate(s.starts_at),
              })),
            ),
            field(
              "computerId",
              "Actual workstation label",
              "select",
              optionList(
                pcs.filter((p) => p.active),
                "label",
              ),
            ),
          ],
          {},
          async (d) => {
            const result = await api("/invigilator/workstation", "POST", d);
            message(result.message);
          },
        );
        $("#f-slotId").onchange = async () => {
          try {
            const slot = catalog.slots.find(
              (s) => s.id === $("#f-slotId").value,
            );
            const computers = await api(
              "/manage/computers?centerId=" + slot.center_id,
            );
            $("#f-computerId").innerHTML = computers
              .filter((p) => p.active)
              .map(
                (p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`,
              )
              .join("");
          } catch (e) {
            message(e.message, "danger");
          }
        };
      } catch (e) {
        message(e.message, "danger");
      }
    };
    return;
  }
  if (view === "Results") {
    rows = await api("/manage/attempts" + queryString());
    target.innerHTML =
      '<div class="d-flex flex-wrap gap-2 mb-3"><button class="btn btn-outline-primary" id="evaluate">Evaluate submitted attempts</button><button class="btn btn-primary" id="publish">Publish evaluated results</button><button class="btn btn-outline-primary" id="announce">Send examination announcement</button></div>' +
      toolbar() +
      table(
        rows,
        cols(
          "name",
          "registration_number",
          "exam_name",
          "status",
          "deadline",
          "submitted_at",
          "result_status",
          "score",
        ),
      ) +
      pagination();
    bindToolbar();
    bindPagination();
    ["evaluate", "publish", "announce"].forEach(
      (action) =>
        ($("#" + action).onclick = () =>
          renderForm(
            action === "announce"
              ? "Send announcement"
              : action === "publish"
                ? "Publish results"
                : "Evaluate attempts",
            [
              field(
                "examId",
                "Examination",
                "select",
                optionList(catalog.exams),
              ),
              ...(action === "announce"
                ? [field("message", "Announcement", "textarea")]
                : []),
            ],
            {},
            async (d) => {
              if (
                action === "publish" &&
                !(await confirmDialog(
                  "Publish results?",
                  "Candidates will be able to see their scores. This action locks published results.",
                ))
              )
                return;
              await api("/manage/" + action, "POST", d);
            },
          )),
    );
    return;
  }
  if (view === "Notifications") {
    rows = await api(
      role === "admin" ? "/manage/notifications" : "/notifications",
    );
    target.innerHTML =
      role === "admin"
        ? '<p class="text-muted">A durable outbox records delivery status. The scheduled jobs endpoint sends queued notifications; failed deliveries can be retried.</p>'
        : "";
    target.innerHTML += table(
      rows,
      cols(
        ...(role === "admin" ? ["email"] : []),
        "event",
        "status",
        "sent_at",
        "error_code",
      ),
      role === "admin"
        ? (r, i) =>
            r.status === "failed" ? button("Retry delivery", "retry", i) : ""
        : null,
    );
    if (role === "admin")
      bindActions(async (a, r) => {
        await api("/manage/notifications/" + r.id + "/retry", "POST", {});
        await load(view);
      });
    return;
  }
  if (view === "Audit") {
    rows = await api("/manage/audit" + queryString());
    target.innerHTML =
      table(rows, cols("actor", "action", "entity_id", "created_at")) +
      pagination();
    bindPagination();
  }
}

if (user) {
  $("#content").className = "container-fluid app-main";
  $("#content").innerHTML =
    `<div class="row g-4"><aside class="col-md-3 col-xl-2"><div class="sidebar"><div class="px-2 pt-2 pb-3 d-none d-md-block"><div class="min-label">${esc(role.toUpperCase())} WORKSPACE</div><strong>${esc(user.name)}</strong></div>${menus[role].map((v) => `<button type="button" data-view="${esc(v)}">${esc(v)}</button>`).join("")}<button type="button" data-signout>Sign out</button></div></aside><div class="col-md-9 col-xl-10"><div class="d-flex justify-content-between align-items-center mb-4"><h1 class="section-title mb-0" id="view-title"></h1><a href="/exam" class="btn btn-outline-primary btn-sm">Central exam portal</a></div><div id="live-message" role="status" aria-live="polite"></div><div id="view-content"></div></div></div>`;
  document.querySelectorAll("[data-view]").forEach(
    (b) =>
      (b.onclick = () => {
        page = 1;
        search = "";
        load(b.dataset.view);
      }),
  );
  $("[data-signout]").onclick = async () => {
    await api("/auth/logout", "POST", {});
    location.href = "/login";
  };
  await load(menus[role][0]);
}
