import React, { useState } from "react";
import { Icon } from "./illustrations.jsx";
import { Password } from "./components.jsx";

export function LoginPage({ role = "candidate", login, navigate }) {
  const [identity, setIdentity] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const roles = [
    {
      key: "candidate",
      label: "Candidate",
      path: "/login",
      action: "Sign in as candidate",
    },
    {
      key: "invigilator",
      label: "Invigilator",
      path: "/invigilator-login",
      action: "Sign in as invigilator",
    },
    {
      key: "admin",
      label: "Administrator",
      path: "/admin-login",
      action: "Sign in as admin",
    },
  ];
  return (
    <main className="signin-page">
      <aside className="signin-story">
        <p className="eyebrow">Examination management</p>
        <h2>
          Exams,
          <br />
          made <span>simpler.</span>
        </h2>
        <p className="signin-story-intro">
          A secure place to manage examinations,
          <br className="desktop-break" /> hall tickets and results.
        </p>
        <div className="signin-features">
          {[
            {
              icon: "calendar",
              title: "Exam schedule",
              text: "View upcoming examinations",
            },
            {
              icon: "ticket",
              title: "Hall tickets",
              text: "Access your admission details",
            },
            {
              icon: "chart",
              title: "Secure results",
              text: "Check published results",
            },
          ].map((f) => (
            <div key={f.title}>
              <span>
                <Icon name={f.icon} size={26} />
              </span>
              <div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="signin-mosaic" aria-hidden="true">
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      </aside>
      <section className="signin-panel">
        <p className="eyebrow">Welcome back</p>
        <h1>
          Sign in to <span>EXAMPRO</span>
        </h1>
        <p className="signin-intro">
          {role === "admin"
            ? "Use your administrator account credentials."
            : role === "invigilator"
              ? "Use your assigned invigilator account."
              : "Use your registered email or mobile number."}
        </p>
        <div
          className="signin-roles"
          role="group"
          aria-label="Sign-in account type"
        >
          {roles.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-label={r.action}
              aria-pressed={role === r.key}
              className={role === r.key ? "active" : ""}
              onClick={() => role !== r.key && navigate(r.path)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await login({ identity, password }, role);
            } catch (err) {
              setError(err.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>Email or mobile number</span>
            <div className="signin-identity">
              <Icon name="person" size={20} />
              <input
                name="identity"
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                required
                autoComplete="username"
                placeholder="Enter your email or mobile number"
              />
            </div>
          </label>
          <div className="signin-password">
            <Icon name="lock" size={20} />
            <Password
              name="password"
              placeholder="Enter your password"
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="signin-recovery">
            <button
              type="button"
              className="text-button"
              onClick={() => navigate("/forgot")}
            >
              Forgot password?
            </button>
          </div>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button className="signin-submit" disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
            <Icon name="arrow" size={18} />
          </button>
        </form>
        {role === "admin" && (
          <p className="signin-admin-note">
            For administrator access, sign in again after opening a new tab or
            reloading.
          </p>
        )}
        {role === "candidate" && (
          <div className="signin-account-links">
            <p>
              New to EXAMPRO?{" "}
              <button
                className="text-button"
                onClick={() => navigate("/signup")}
              >
                Create account
              </button>
            </p>
            <button className="text-button" onClick={() => navigate("/resume")}>
              Continue email verification
            </button>
          </div>
        )}
        {role !== "candidate" && (
          <div className="signin-account-links">
            <button className="text-button" onClick={() => navigate("/login")}>
              Back to candidate sign in
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
