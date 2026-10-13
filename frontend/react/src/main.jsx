import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, home, setAdminAccess, dateText } from "./api.js";
import { Form, field, Notice } from "./components.jsx";
import { Workspace } from "./workspace.jsx";
import { Exam } from "./exam.jsx";
import { Avatar, Icon } from "./illustrations.jsx";
import "./styles.css";
import "./pastel.css";
const protectedPaths = [
  "/manage",
  "/dashboard",
  "/invigilator",
  "/examiner",
  "/exam",
  "/verify",
];
function App() {
  const [path, setPath] = useState(location.pathname.replace(/\/$/, "") || "/"),
    [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(null);
  const navigate = (url, replace = false) => {
    if (url === "/login") {
      setAdminAccess(null);
      setUser(null);
    }
    history[replace ? "replaceState" : "pushState"]({}, "", url);
    setPath(url);
    setNotice(null);
  };
  useEffect(() => {
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    if (protectedPaths.includes(location.pathname)) {
      api("/me")
        .then((u) => {
          setUser(u);
          if (u.status === "pending" && location.pathname !== "/verify")
            navigate("/verify", true);
        })
        .catch(() => navigate("/login", true))
        .finally(() => setLoading(false));
    } else setLoading(false);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const link = (e, url) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    e.preventDefault();
    if (protectedPaths.includes(url) && !user) navigate("/login");
    else navigate(url);
  };
  const login = async (data) => {
    const u = await api(
      path === "/invigilator-login" ? "/auth/invigilator-login" : "/auth/login",
      "POST",
      data,
    );
    setAdminAccess(u.adminAccess);
    setUser(u);
    navigate(home(u.role));
  };
  const logout = async () => {
    try {
      await api("/auth/logout", "POST", {});
    } finally {
      setAdminAccess(null);
      setUser(null);
      navigate("/login");
    }
  };
  const allowed = {
    manage: "admin",
    dashboard: "candidate",
    invigilator: "invigilator",
    examiner: "examiner",
    exam: "candidate",
  }[path.slice(1)];
  useEffect(() => {
    if (!loading && allowed && user && allowed !== user.role)
      navigate(home(user.role), true);
  }, [path, user, loading]);
  return (
    <>
      <header className="topbar">
        <a href="/" onClick={(e) => link(e, "/")} className="brand">
          <span className="brand-symbol">
            <Icon name="cap" size={29} />
          </span>
          <span>
            EXAMPRO<small>Examination services</small>
          </span>
        </a>
        <nav>
          <a href="/exam" onClick={(e) => link(e, "/exam")}>
            Exam portal
          </a>
          {user ? (
            <>
              <span className="identity">{user.name}</span>
              <button className="text-button" onClick={logout}>
                Sign out
              </button>
            </>
          ) : (
            <a href="/login" onClick={(e) => link(e, "/login")}>
              Sign in <span aria-hidden="true">↗</span>
            </a>
          )}
        </nav>
      </header>
      {loading ? (
        <main className="page">
          <p role="status">Opening your portal…</p>
        </main>
      ) : path === "/" ? (
        <Landing navigate={navigate} />
      ) : protectedPaths.includes(path) && !user ? (
        <main className="page">
          <p>Sign in to continue.</p>
          <button onClick={() => navigate("/login")}>Sign in</button>
        </main>
      ) : path === "/verify" ? (
        <Verify
          user={user}
          onVerified={async () => {
            const u = await api("/me");
            setUser(u);
            navigate(home(u.role));
          }}
        />
      ) : path === "/exam" ? (
        <Exam />
      ) : allowed && user?.role === allowed ? (
        <Workspace user={user} navigate={navigate} />
      ) : (
        <AuthPage
          key={path}
          path={path}
          login={login}
          navigate={navigate}
          setUser={setUser}
          setNotice={setNotice}
          notice={notice}
        />
      )}
      <footer className="footer">
        <span>EXAMPRO</span>
        <span>
          Authorized examination centers · All displayed times are local
        </span>
      </footer>
    </>
  );
}
function Landing({ navigate }) {
  const [exams, setExams] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    api("/examinations")
      .then(setExams)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="landing">
      <section className="hero">
        <div>
          <p className="eyebrow">Candidate services</p>
          <h1>
            Your next examination.
            <br />
            One place to prepare.
          </h1>
          <p className="lede">
            Register, track your application and find your allocated examination
            center. When it is time to write, your invigilator will help you get
            started.
          </p>
          <div className="hero-actions">
            <button onClick={() => navigate("/signup")}>
              Create candidate account <span>→</span>
            </button>
            <button className="secondary" onClick={() => navigate("/login")}>
              Sign in
            </button>
          </div>
        </div>
        <aside className="hero-aside">
          <span className="edition">THE EXAMINATION PROCESS</span>
          {[
            [
              "01",
              "Register & verify",
              "Create your account with a personal email.",
            ],
            [
              "02",
              "Get your hall ticket",
              "Find your allocated center and exam slot.",
            ],
            [
              "03",
              "Write at your center",
              "Complete identity and workstation verification.",
            ],
          ].map(([n, t, d]) => (
            <div className="process" key={n}>
              <span>{n}</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </div>
          ))}
          <button
            className="text-button"
            onClick={() => navigate("/invigilator-login")}
          >
            Invigilator sign in →
          </button>
        </aside>
      </section>
      <section className="exam-list">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Examination calendar</p>
            <h2>Available examinations</h2>
          </div>
          <span>{exams.length} listed</span>
        </div>
        <Notice message={error ? { text: error, kind: "error" } : null} />
        {exams.length
          ? exams.map((e) => (
              <article className="exam-list-row" key={e.id}>
                <div>
                  <h3>{e.name}</h3>
                  <p>{e.description}</p>
                </div>
                <div>
                  <small>Registration closes</small>
                  <p>{dateText(e.registration_end)}</p>
                </div>
                <button
                  className="secondary"
                  onClick={() => navigate("/login")}
                >
                  View examination →
                </button>
              </article>
            ))
          : !error && (
              <p className="empty">
                Examinations will appear here when registration opens.
              </p>
            )}
      </section>
    </main>
  );
}
function AuthPage({ path, login, navigate, setUser, setNotice, notice }) {
  const [illustrationGender, setIllustrationGender] = useState(null);
  const signup = path === "/signup",
    invigilator = path === "/invigilator-login";
  let title = "Welcome back",
    intro = "Sign in to your EXAMPRO account.",
    button = "Sign in",
    fields = [
      field("identity", "Email or mobile number"),
      field("password", "Password", "password"),
    ],
    submit = login;
  if (invigilator) {
    title = "Invigilator sign in";
    intro =
      "Use your administrator-issued account to admit candidates and authorize workstation browsers.";
    fields = [
      field("identity", "Invigilator email", "email"),
      field("password", "Password", "password"),
    ];
  }
  if (signup) {
    title = "Create your candidate account";
    intro =
      "Start with your personal details. We will verify your email before you register for an examination.";
    button = "Create account";
    fields = [
      field("name", "Full name"),
      field("email", "Email", "email"),
      field("phone", "Mobile with country code", "tel", null, {
        help: "For example +919876543210",
      }),
      field("dob", "Date of birth", "date"),
      field(
        "gender",
        "Gender",
        "select",
        [
          { value: "male", label: "Male" },
          { value: "female", label: "Female" },
        ],
        {
          help: "Used for your profile illustration. You can update it in Profile.",
        },
      ),
      field("address", "Address", "textarea", null, { wide: true }),
      field("password", "Password — at least 12 characters", "password"),
      field("confirmPassword", "Confirm password", "password"),
    ];
    submit = async (d) => {
      await api("/auth/signup", "POST", d);
      setUser(await api("/me"));
      navigate("/verify");
    };
  }
  if (path === "/resume") {
    title = "Continue email verification";
    fields = [
      field("email", "Registered email", "email"),
      field("password", "Password", "password"),
    ];
    submit = async (d) => {
      await api("/auth/resume", "POST", d);
      setUser(await api("/me"));
      navigate("/verify");
    };
  }
  if (path === "/forgot") {
    title = "Recover your account";
    intro = "We will email a recovery code if this account is eligible.";
    button = "Send recovery code";
    fields = [field("email", "Registered email", "email")];
    submit = async (d) => {
      const r = await api("/auth/forgot", "POST", d);
      setNotice({ text: r.message });
    };
  }
  if (path === "/reset") {
    title = "Set a new account password";
    intro = "Enter the email recovery code and choose your new password.";
    fields = [
      field("email", "Registered email", "email"),
      field("code", "Six-digit email code"),
      field("password", "New password", "password"),
      field("confirmPassword", "Confirm new password", "password"),
    ];
    submit = async (d) => {
      const r = await api("/auth/reset", "POST", d);
      setNotice({ text: r.message });
    };
  }
  if (path === "/exam-setup") {
    title = "Choose your examination password";
    intro =
      "This password is separate from your account login. Your previous examination password will stop working.";
    fields = [
      field("password", "Examination password", "password"),
      field("confirmPassword", "Confirm password", "password"),
    ];
    submit = async (d) => {
      const token = location.hash.slice(1);
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new Error(
          "Open the single-use link from your examination email.",
        );
      const r = await api("/exam/password", "POST", { ...d, token });
      history.replaceState({}, "", "/exam-setup");
      setNotice({ text: r.message });
    };
  }
  return (
    <main className={`auth-page ${signup ? "signup-page" : ""}`}>
      <aside className="auth-note">
        <Avatar
          gender={illustrationGender}
          scene
          className="auth-illustration"
        />
        <p className="eyebrow">EXAMPRO / ACCOUNT ACCESS</p>
        <h2>
          {invigilator
            ? "A considered start to every examination."
            : "The details matter."}
        </h2>
        <p>
          {invigilator
            ? "Verify the candidate. Match the center and slot. Authorize the right workstation."
            : "Keep your account and examination credentials separate. Your allocated hall ticket and schedule are available in your candidate dashboard."}
        </p>
        <div className="auth-rule" />
        <p className="small">
          Admin access requires a fresh sign-in whenever this page is opened in
          a new tab or reloaded.
        </p>
      </aside>
      <section className="auth-panel">
        <button className="text-button back" onClick={() => navigate("/")}>
          ← Back to portal
        </button>
        <p className="eyebrow">
          {signup
            ? "Candidate registration"
            : invigilator
              ? "Center staff"
              : "Secure account access"}
        </p>
        <h1>{title}</h1>
        <p className="muted">{intro}</p>
        <Notice message={notice} />
        <Form
          fields={fields}
          onSubmit={submit}
          button={button}
          onValuesChange={
            signup ? (v) => setIllustrationGender(v.gender || null) : undefined
          }
        />
        <div className="auth-links">
          {["/login", "/invigilator-login"].includes(path) && (
            <>
              <button
                className="text-button"
                onClick={() => navigate("/forgot")}
              >
                Forgot password?
              </button>
              <button
                className="text-button"
                onClick={() => navigate(invigilator ? "/login" : "/signup")}
              >
                {invigilator
                  ? "Candidate / administrator sign in"
                  : "Create an account"}
              </button>
            </>
          )}
          {path === "/login" && (
            <>
              <button
                className="text-button"
                onClick={() => navigate("/invigilator-login")}
              >
                Sign in as invigilator →
              </button>
              <button
                className="text-button"
                onClick={() => navigate("/resume")}
              >
                Continue email verification
              </button>
            </>
          )}
          {path === "/forgot" && (
            <button className="text-button" onClick={() => navigate("/reset")}>
              I already have a recovery code →
            </button>
          )}
          {!["/login", "/invigilator-login", "/forgot"].includes(path) && (
            <button className="text-button" onClick={() => navigate("/login")}>
              Back to sign in
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
function Verify({ user, onVerified }) {
  const [notice, setNotice] = useState(null),
    [wait, setWait] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!wait) return;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  return (
    <main className="single-panel">
      <p className="eyebrow">One final account step</p>
      <h1>Verify your email</h1>
      <p>
        We will send a six-digit code to <strong>{user.email}</strong>. It
        expires after 10 minutes.
      </p>
      <Notice message={notice} />
      {user.emailVerified ? (
        <button onClick={onVerified}>Continue to dashboard →</button>
      ) : (
        <>
          <button
            className="secondary"
            disabled={!!wait || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api("/auth/send-code", "POST", {
                  channel: "email",
                });
                setNotice({ text: r.message });
                setWait(60);
              } catch (e) {
                setNotice({ text: e.message, kind: "error" });
              } finally {
                setBusy(false);
              }
            }}
          >
            {wait ? `Resend in ${wait}s` : "Send email code"}
          </button>
          <Form
            fields={[field("code", "Six-digit verification code")]}
            button="Verify email"
            onSubmit={async (d) => {
              await api("/auth/verify-code", "POST", {
                ...d,
                channel: "email",
              });
              await onVerified();
            }}
          />
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
