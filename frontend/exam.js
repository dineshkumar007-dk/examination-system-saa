import {
  $,
  api,
  esc,
  me,
  bindForm,
  passwordField,
  setupToggles,
  message,
  confirmDialog,
} from "./common.js";
const user = await me(["candidate"]);
let attempt,
  index = 0,
  answers = new Map(),
  saving = false,
  offset = 0,
  clock;
let expiring = false,
  ticks = 0;
if (user) {
  $("#content").className = "container-fluid exam-shell";
  await restore();
}
function loginScreen() {
  $("#content").innerHTML =
    `<div class="auth-wrap"><div class="card"><div class="card-body"><span class="badge-soft mb-3">Authorized center access</span><h1 class="section-title">Central examination portal</h1><p class="text-muted">After invigilator verification, sign in from your allocated workstation during your scheduled slot.</p><form id="exam-login"><label class="form-label" for="registrationNumber">Registration ID</label><input class="form-control mb-3" name="registrationNumber" id="registrationNumber" required><label class="form-label" for="hallNumber">Hall ticket number</label><input class="form-control mb-3" name="hallNumber" id="hallNumber" required>${passwordField("Examination password", "password")}<button class="btn btn-primary w-100 mt-4">Begin / resume examination</button></form><div id="live-message" role="status" aria-live="polite"></div><p class="form-help mt-3">Use the separate examination password created through your emailed activation link.</p></div></div></div>`;
  setupToggles();
  bindForm($("#exam-login"), async (d) => {
    await api("/exam/login", "POST", d);
    await restore();
  });
}
async function restore() {
  try {
    const result = await api("/exam/attempt");
    if (result.submitted) {
      receipt();
      return;
    }
    attempt = result;
    offset = result.serverTime - Date.now();
    answers = new Map(
      result.answers.map((a) => [a.question_id, { ...a, review: !!a.review }]),
    );
    renderShell();
    renderQuestion();
    if (clock) clearInterval(clock);
    clock = setInterval(tick, 1000);
    tick();
  } catch (e) {
    loginScreen();
    if (e.status !== 401) message(e.message, "danger");
  }
}
function receipt() {
  if (clock) clearInterval(clock);
  $("#content").innerHTML =
    '<div class="auth-wrap"><div class="card"><div class="card-body"><span class="badge-soft mb-3">Submission recorded</span><h1 class="section-title">Your examination has been submitted successfully.</h1><p>Your responses have been recorded.</p><p class="text-muted">The examination authority will announce results after evaluation and publication.</p><a class="btn btn-primary" href="/dashboard">Return to dashboard</a></div></div></div>';
}
function renderShell() {
  $("#content").innerHTML =
    `<div class="card mb-3"><div class="card-body py-3 d-flex justify-content-between align-items-center flex-wrap gap-3"><div><h1 class="h5 mb-1">${esc(attempt.examName)}</h1><span class="text-muted small">${esc(attempt.candidateName)}</span></div><div><div class="min-label">TIME REMAINING</div><div id="timer" class="timer" role="timer" aria-label="Time remaining"></div></div></div></div><div id="live-message" role="status" aria-live="polite"></div><div class="row g-3"><div class="col-lg-9"><div class="card"><div class="card-body"><div id="question"></div><div class="d-flex flex-wrap gap-2 border-top pt-3 mt-4"><button id="previous" class="btn btn-outline-secondary">Previous</button><button id="review" class="btn btn-outline-primary">Mark for review</button><button id="clear" class="btn btn-outline-secondary">Clear response</button><button id="next" class="btn btn-primary ms-auto">Save & next</button></div><p id="save-status" class="form-help mt-3 mb-0" aria-live="polite">Responses are saved when you navigate, review or clear.</p></div></div></div><aside class="col-lg-3"><div class="card"><div class="card-body"><h2 class="h6 mb-3">Question palette</h2><div class="palette" id="palette"></div><div class="form-help my-3">Gray: not visited<br>Orange: not answered<br>Green: answered<br>Purple: review<br>Purple with green border: answered & review</div><button id="submit" class="btn btn-primary w-100">Submit examination</button><details class="mt-3 small"><summary>Examination instructions</summary><p class="mt-2">${esc(attempt.instructions)}</p></details></div></div></aside></div>`;
  $("#previous").onclick = () => navigate(Math.max(0, index - 1));
  $("#next").onclick = () =>
    navigate(Math.min(attempt.questions.length - 1, index + 1));
  $("#review").onclick = async () => {
    const q = attempt.questions[index];
    const old = answers.get(q.id);
    if (await saveCurrent(!old?.review)) renderQuestion();
  };
  $("#clear").onclick = async () => {
    document.querySelectorAll('[name="response"]').forEach((input) => {
      if (input.type === "number") input.value = "";
      else input.checked = false;
    });
    if (await saveCurrent()) renderQuestion();
  };
  $("#submit").onclick = submit;
}
function state(answer) {
  if (!answer) return "unvisited";
  const filled =
    answer.answer !== null &&
    answer.answer !== undefined &&
    (!Array.isArray(answer.answer) || answer.answer.length > 0);
  return answer.review
    ? filled
      ? "answered-review"
      : "review"
    : filled
      ? "answered"
      : "unanswered";
}
function renderQuestion() {
  const q = attempt.questions[index],
    a = answers.get(q.id);
  $("#question").innerHTML =
    `<div class="d-flex justify-content-between align-items-center mb-4"><span class="badge-soft">Question ${index + 1} of ${attempt.questions.length}</span><span class="form-help">${esc(q.type)} · +${esc(q.marks)} / −${esc(q.negative_marks)}</span></div><div class="question-area"><p class="question-text">${esc(q.prompt)}</p>${q.type === "NAT" ? `<label class="form-label" for="nat-response">Numeric answer</label><input id="nat-response" name="response" class="form-control" type="number" step="any" value="${esc(a?.answer ?? "")}" placeholder="Enter your response">` : `<fieldset><legend class="visually-hidden">Choose ${q.type === "MSQ" ? "one or more options" : "one option"}</legend>${q.options.map((o) => `<label class="option-row"><input type="${q.type === "MSQ" ? "checkbox" : "radio"}" name="response" value="${esc(o.id)}" ${a?.answer?.includes?.(o.id) ? "checked" : ""}><span><strong>${esc(o.id)}.</strong> ${esc(o.text)}</span></label>`).join("")}</fieldset>`}</div>`;
  $("#review").textContent = a?.review
    ? "Remove review mark"
    : "Mark for review";
  $("#previous").disabled = index === 0;
  $("#next").textContent =
    index === attempt.questions.length - 1 ? "Save response" : "Save & next";
  $("#palette").innerHTML = attempt.questions
    .map(
      (q, i) =>
        `<button class="${state(answers.get(q.id))} ${i === index ? "current" : ""}" data-question="${i}" aria-label="Question ${i + 1}, ${state(answers.get(q.id)).replaceAll("-", " ")}" ${i === index ? 'aria-current="true"' : ""}>${i + 1}</button>`,
    )
    .join("");
  document
    .querySelectorAll("[data-question]")
    .forEach((b) => (b.onclick = () => navigate(Number(b.dataset.question))));
}
function response() {
  const q = attempt.questions[index];
  if (q.type === "NAT") {
    const raw = $("#nat-response").value;
    return raw === "" ? null : Number(raw);
  }
  const selected = [
    ...document.querySelectorAll('[name="response"]:checked'),
  ].map((i) => i.value);
  return selected.length ? selected : null;
}
function lock(value) {
  saving = value;
  document
    .querySelectorAll("#content button,#content input")
    .forEach((b) => (b.disabled = value));
}
async function saveCurrent(review) {
  if (saving) return false;
  const q = attempt.questions[index],
    old = answers.get(q.id);
  const answer = response();
  lock(true);
  $("#save-status").textContent = "Saving response…";
  try {
    const result = await api("/exam/answer", "PUT", {
      questionId: q.id,
      answer,
      review: review ?? old?.review ?? false,
      expectedRevision: old?.revision || 0,
    });
    if (result.submitted) {
      receipt();
      return false;
    }
    answers.set(q.id, {
      answer,
      review: review ?? old?.review ?? false,
      revision: result.revision,
    });
    $("#save-status").textContent = "Response saved to the examination server.";
    return true;
  } catch (e) {
    message(e.message + " Your current response has not been saved.", "danger");
    $("#save-status").textContent = "Save failed. Retry before navigating.";
    return false;
  } finally {
    lock(false);
  }
}
async function navigate(next) {
  if (await saveCurrent()) {
    index = next;
    renderQuestion();
  }
}
async function submit() {
  if (!(await saveCurrent())) return;
  let answered = 0,
    review = 0;
  for (const a of answers.values()) {
    if (a.answer !== null && a.answer !== undefined) answered++;
    if (a.review) review++;
  }
  if (
    !(await confirmDialog(
      "Submit examination?",
      `Total: ${attempt.questions.length}. Answered: ${answered}. Unanswered: ${attempt.questions.length - answered}. Marked for review: ${review}. Submission locks all responses.`,
    ))
  )
    return;
  lock(true);
  try {
    const result = await api("/exam/submit", "POST", {});
    if (result.submitted) receipt();
  } catch (e) {
    message(e.message, "danger");
    lock(false);
  }
}

async function tick() {
  if (!$("#timer")) return;
  const remaining = Math.max(
    0,
    Math.ceil((attempt.deadline - Date.now() - offset) / 1000),
  );
  $("#timer").textContent =
    `${String(Math.floor(remaining / 3600)).padStart(2, "0")}:${String(Math.floor((remaining % 3600) / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  if (!remaining && !expiring) {
    expiring = true;
    try {
      const latest = await api("/exam/attempt");
      if (latest.submitted) receipt();
      else {
        offset = latest.serverTime - Date.now();
        attempt.deadline = latest.deadline;
      }
    } catch (e) {
      message(
        "Time expired. The server will finalize saved responses. " + e.message,
        "danger",
      );
    } finally {
      expiring = false;
    }
  } else if (++ticks % 30 === 0) {
    try {
      const latest = await api("/exam/attempt");
      if (latest.submitted) {
        receipt();
        return;
      }
      offset = latest.serverTime - Date.now();
    } catch (e) {
      message(e.message, "danger");
    }
  }
}
