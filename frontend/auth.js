import {
  $,
  api,
  message,
  bindForm,
  passwordField,
  setupToggles,
  home,
  esc,
} from "./common.js";
const page = document.body.dataset.page;
const input = (label, name, type = "text", extra = "") =>
  `<div class="mb-3"><label class="form-label" for="${name}">${label}</label><input class="form-control" id="${name}" name="${name}" type="${type}" ${extra} required></div>`;
const pass = (label, name) =>
  `<div class="mb-3">${passwordField(label, name)}</div>`;
const layouts = {
  login: {
    title: "Welcome back",
    intro: "Sign in to your registered EXAMPRO account.",
    fields:
      input(
        "Email or mobile number",
        "identity",
        "text",
        'autocomplete="username"',
      ) + pass("Password", "password"),
    button: "Sign in",
    footer:
      '<a href="/forgot">Forgot password?</a> · <a href="/resume">Continue contact verification</a><hr>New candidate? <a href="/signup">Create an account</a><hr><a href="/invigilator-login">Sign in as invigilator</a>',
  },
  "invigilator-login": {
    title: "Sign in as invigilator",
    intro:
      "Use your administrator-issued invigilator account to check candidates and authorize exam devices at your assigned center.",
    fields:
      input(
        "Invigilator email",
        "identity",
        "email",
        'autocomplete="username"',
      ) + pass("Password", "password"),
    button: "Sign in as invigilator",
    footer:
      '<a href="/forgot">Forgot password?</a><hr>Invigilator accounts are created by the examination administrator. <a href="/login">Back to account sign in</a>',
  },
  resume: {
    title: "Continue verification",
    intro: "Enter the credentials you used when registering.",
    fields:
      input("Registered email", "email", "email", 'autocomplete="email"') +
      pass("Password", "password"),
    button: "Continue",
    footer: '<a href="/login">Back to sign in</a>',
  },
  signup: {
    title: "Create your candidate account",
    intro:
      "Verify your personal email before completing examination registration. Your mobile number is retained as contact information.",
    fields:
      '<div class="row"><div class="col-md-6">' +
      input(
        "Full name",
        "name",
        "text",
        'autocomplete="name" maxlength="120"',
      ) +
      input(
        "Email address",
        "email",
        "email",
        'autocomplete="email" maxlength="254"',
      ) +
      input(
        "Mobile with country code",
        "phone",
        "tel",
        'placeholder="+919876543210" autocomplete="tel" pattern="\\+[1-9][0-9]{7,14}"',
      ) +
      '</div><div class="col-md-6">' +
      input(
        "Date of birth",
        "dob",
        "date",
        'max="' + new Date().toISOString().slice(0, 10) + '"',
      ) +
      input(
        "Address",
        "address",
        "text",
        'autocomplete="street-address" minlength="5" maxlength="500"',
      ) +
      '<label class="form-label" for="examId">Examination (optional)</label><select class="form-select mb-3" name="examId" id="examId"><option value="">Select later</option></select></div></div><div class="row"><div class="col-md-6">' +
      pass("Password", "password") +
      '</div><div class="col-md-6">' +
      pass("Confirm password", "confirmPassword") +
      '</div></div><p class="form-help">Use at least 12 characters, up to 72 bytes. Keep this password private. No government ID number is collected online.</p>',
    button: "Create account & verify email",
    footer: 'Already registered? <a href="/login">Sign in</a>',
  },
  forgot: {
    title: "Recover your account",
    intro:
      "Request a real email recovery code. If you receive a code, enter it on the reset page.",
    fields: input("Registered email", "email", "email", 'autocomplete="email"'),
    button: "Request recovery code",
    footer:
      '<a href="/reset">I already have a code</a> · <a href="/login">Back to sign in</a>',
  },
  reset: {
    title: "Set a new account password",
    intro:
      "Recovery codes expire after 10 minutes and can be used only once. Your previous sessions will be revoked.",
    fields:
      input("Registered email", "email", "email") +
      input(
        "Email recovery code",
        "code",
        "text",
        'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"',
      ) +
      pass("New password", "password") +
      pass("Confirm password", "confirmPassword"),
    button: "Reset password",
    footer: '<a href="/forgot">Request another code</a>',
  },
  "exam-setup": {
    title: "Set your examination password",
    intro:
      "This password is separate from your ordinary account password. Use the single-use link sent by the examination authority.",
    fields:
      pass("Examination password", "password") +
      pass("Confirm password", "confirmPassword"),
    button: "Set examination password",
    footer: '<a href="/login">Sign in to your account</a>',
  },
};
if (layouts[page]) {
  const d = layouts[page];
  $("#content").innerHTML =
    `<div class="auth-wrap ${page === "signup" ? "wide" : ""}"><div class="card"><div class="card-body"><span class="badge-soft mb-3">EXAMPRO account</span><h1 class="section-title">${d.title}</h1><p class="text-muted">${d.intro}</p><form id="auth-form">${d.fields}<button class="btn btn-primary w-100 mt-2" type="submit">${d.button}</button></form><div id="live-message" role="status" aria-live="polite"></div><div class="mt-4 form-help">${d.footer}</div></div></div></div>`;
  setupToggles();
  if (page === "signup")
    api("/examinations")
      .then((exams) =>
        exams
          .filter((e) => e.status === "open")
          .forEach((e) =>
            $("#examId").insertAdjacentHTML(
              "beforeend",
              `<option value="${esc(e.id)}">${esc(e.name)}</option>`,
            ),
          ),
      )
      .catch((e) => message(e.message, "danger"));
  bindForm($("#auth-form"), async (data) => {
    if (page === "login" || page === "invigilator-login") {
      const u = await api(
        page === "invigilator-login"
          ? "/auth/invigilator-login"
          : "/auth/login",
        "POST",
        data,
      );
      location.href = home(u.role);
    }
    if (page === "resume") {
      await api("/auth/resume", "POST", data);
      location.href = "/verify";
    }
    if (page === "signup") {
      if (!data.examId) delete data.examId;
      await api("/auth/signup", "POST", data);
      location.href = "/verify";
    }
    if (page === "forgot") {
      const r = await api("/auth/forgot", "POST", data);
      message(r.message + " Use “I already have a code” below.");
    }
    if (page === "reset") {
      const r = await api("/auth/reset", "POST", data);
      message(r.message);
      $("#auth-form").reset();
    }
    if (page === "exam-setup") {
      const value = location.hash.slice(1);
      if (!/^[a-f0-9]{64}$/.test(value))
        throw new Error(
          "Open the password setup link from your official email.",
        );
      const r = await api("/exam/password", "POST", { ...data, token: value });
      history.replaceState(null, "", "/exam-setup");
      message(r.message);
      $("#auth-form").reset();
    }
  });
}
if (page === "verify") {
  try {
    const u = await api("/me");
    if (u.status === "active") location.href = home(u.role);
    $("#content").innerHTML =
      `<div class="auth-wrap"><div class="card"><div class="card-body"><span class="badge-soft mb-3">Email verification</span><h1 class="section-title">Verify your email</h1><p class="text-muted">Request an email code and enter it below. Codes expire after 10 minutes. Resends require a 60-second wait.</p>${[
        "email",
      ]
        .map((channel) => {
          const verified = u.emailVerified;
          return `<section class="status-box mb-3"><h2 class="h6">Email: ${esc(u.email)}</h2>${verified ? '<span class="badge-soft">Verified</span>' : `<button class="btn btn-outline-primary btn-sm mb-3" data-send="${channel}">Send email code</button><form data-verify="${channel}"><label class="form-label" for="${channel}-code">Six-digit code</label><div class="input-group"><input class="form-control" id="${channel}-code" name="code" pattern="[0-9]{6}" maxlength="6" inputmode="numeric" autocomplete="one-time-code" required><button class="btn btn-primary" type="submit">Verify</button></div></form>`}</section>`;
        })
        .join(
          "",
        )}<div id="live-message" role="status" aria-live="polite"></div><button class="btn btn-link px-0" data-logout>Sign out</button></div></div></div>`;
    document.querySelectorAll("[data-send]").forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          try {
            const r = await api("/auth/send-code", "POST", {
              channel: b.dataset.send,
            });
            message(r.message);
            let remaining = 60;
            const timer = setInterval(() => {
              b.textContent = `Resend in ${--remaining}s`;
              if (remaining <= 0) {
                clearInterval(timer);
                b.disabled = false;
                b.textContent = "Resend code";
              }
            }, 1000);
          } catch (e) {
            message(e.message, "danger");
            b.disabled = false;
          }
        }),
    );
    document.querySelectorAll("[data-verify]").forEach((form) =>
      bindForm(form, async (data) => {
        await api("/auth/verify-code", "POST", {
          ...data,
          channel: form.dataset.verify,
        });
        location.reload();
      }),
    );
    $("[data-logout]").onclick = async () => {
      await api("/auth/logout", "POST", {});
      location.href = "/login";
    };
  } catch (e) {
    $("#content").innerHTML =
      '<div class="auth-wrap"><div id="live-message" role="alert"></div><a href="/resume">Resume verification with your account credentials</a></div>';
    message(e.message, "danger");
  }
}
