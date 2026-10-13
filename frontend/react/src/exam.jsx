import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Form, field, Notice, useConfirm } from "./components.jsx";
export function Exam() {
  const [attempt, setAttempt] = useState(null),
    [answers, setAnswers] = useState({}),
    [index, setIndex] = useState(0),
    [draft, setDraft] = useState(null),
    [notice, setNotice] = useState(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [remaining, setRemaining] = useState(0),
    [submitted, setSubmitted] = useState(false);
  const offset = useRef(0),
    saving = useRef(false),
    polling = useRef(false);
  const [ask, confirmation] = useConfirm();
  const load = async () => {
    try {
      const r = await api("/exam/attempt");
      if (r.submitted) {
        setSubmitted(true);
        setAttempt(null);
        return;
      }
      offset.current = r.serverTime - Date.now();
      setAttempt(r);
      const a = Object.fromEntries(
        r.answers.map((v) => [v.question_id, { ...v, review: !!v.review }]),
      );
      setAnswers(a);
      setDraft(a[r.questions[0]?.id]?.answer ?? null);
      setIndex(0);
    } catch (e) {
      if (e.status !== 401) setNotice({ text: e.message, kind: "error" });
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!attempt) return;
    let ticks = 0;
    const tick = async () => {
      const seconds = Math.max(
        0,
        Math.ceil((attempt.deadline - Date.now() - offset.current) / 1000),
      );
      setRemaining(seconds);
      if ((seconds === 0 || ++ticks % 30 === 0) && !polling.current) {
        polling.current = true;
        try {
          const r = await api("/exam/attempt");
          if (r.submitted) {
            setSubmitted(true);
            setAttempt(null);
          } else {
            offset.current = r.serverTime - Date.now();
          }
        } catch (e) {
          setNotice({
            text:
              (seconds === 0
                ? "Time has ended. The server will finalize saved answers. "
                : "") + e.message,
            kind: "error",
          });
        } finally {
          polling.current = false;
        }
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [attempt?.id]);
  const save = async (review, value = draft) => {
    if (saving.current || !attempt) return null;
    saving.current = true;
    setBusy(true);
    try {
      const q = attempt.questions[index],
        old = answers[q.id];
      const result = await api("/exam/answer", "PUT", {
        questionId: q.id,
        answer: value,
        review: review ?? old?.review ?? false,
        expectedRevision: old?.revision || 0,
      });
      const entry = {
        question_id: q.id,
        answer: value,
        review: review ?? old?.review ?? false,
        revision: result.revision,
      };
      const next = { ...answers, [q.id]: entry };
      setAnswers(next);
      setNotice({ text: "Response saved." });
      return next;
    } catch (e) {
      setNotice({ text: e.message, kind: "error" });
      return null;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const move = async (next) => {
    const updated = await save();
    if (updated) {
      setIndex(next);
      setDraft(updated[attempt.questions[next].id]?.answer ?? null);
    }
  };
  const submit = async () => {
    const updated = await save();
    if (!updated) return;
    const answered = Object.values(updated).filter(
      (a) =>
        a.answer !== null &&
        a.answer !== undefined &&
        (!Array.isArray(a.answer) || a.answer.length),
    ).length;
    const reviews = Object.values(updated).filter((a) => a.review).length;
    if (
      !(await ask(
        `Submit ${attempt.questions.length} questions? ${answered} answered, ${attempt.questions.length - answered} unanswered, ${reviews} marked for review. Submitted responses cannot be changed.`,
      ))
    )
      return;
    setBusy(true);
    try {
      await api("/exam/submit", "POST", {});
      setSubmitted(true);
      setAttempt(null);
    } catch (e) {
      setNotice({ text: e.message, kind: "error" });
    } finally {
      setBusy(false);
    }
  };
  if (loading)
    return (
      <main className="page">
        <p role="status">Checking examination access…</p>
      </main>
    );
  if (submitted)
    return (
      <main className="single-panel">
        <p className="eyebrow">Submission recorded</p>
        <h1>Your responses have been submitted.</h1>
        <p>
          The examination authority will publish your results after evaluation.
        </p>
        <a className="button" href="/dashboard">
          Return to dashboard →
        </a>
      </main>
    );
  if (!attempt)
    return (
      <main className="single-panel">
        <p className="eyebrow">Authorized center access</p>
        <h1>Central examination portal</h1>
        <p>
          Sign in during your scheduled slot, from the browser authorized by
          your invigilator.
        </p>
        <Notice message={notice} />
        <Form
          fields={[
            field("registrationNumber", "Registration ID"),
            field("hallNumber", "Hall ticket number"),
            field("password", "Examination password", "password"),
          ]}
          button="Begin / resume examination"
          onSubmit={async (d) => {
            await api("/exam/login", "POST", d);
            setNotice(null);
            await load();
          }}
        />
        <p className="muted small">
          Use the examination password from your credentials email. It is
          separate from your account password.
        </p>
      </main>
    );
  const q = attempt.questions[index],
    answer = answers[q.id];
  const state = (a) =>
    !a
      ? "unvisited"
      : a.review
        ? "review"
        : a.answer !== null &&
            a.answer !== undefined &&
            a.answer !== "" &&
            (!Array.isArray(a.answer) || a.answer.length > 0)
          ? "answered"
          : "unanswered";
  const time = [
    Math.floor(remaining / 3600),
    Math.floor((remaining % 3600) / 60),
    remaining % 60,
  ]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
  const locked = busy || remaining === 0;
  return (
    <main className="cbt">
      <header className="exam-header">
        <div>
          <p className="eyebrow">Examination in progress</p>
          <h1>{attempt.examName}</h1>
          <p>{attempt.candidateName}</p>
        </div>
        <div className="timer">
          <small>Time remaining</small>
          <strong role="timer" aria-label="Time remaining">
            {time}
          </strong>
        </div>
      </header>
      <Notice message={notice} />
      <div className="cbt-grid">
        <section className="panel question">
          <div className="question-meta">
            <span>
              Question {index + 1} / {attempt.questions.length}
            </span>
            <span>
              {q.type} · +{q.marks} / −{q.negative_marks}
            </span>
          </div>
          <h2>{q.prompt}</h2>
          {q.type === "NAT" ? (
            <label className="field">
              <span>Numeric answer</span>
              <input
                disabled={locked}
                type="number"
                step="any"
                value={draft ?? ""}
                onChange={(e) =>
                  setDraft(
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </label>
          ) : (
            <fieldset className="option-list">
              <legend className="sr-only">
                {q.type === "MSQ"
                  ? "Select one or more answers"
                  : "Select one answer"}
              </legend>
              {q.options.map((o) => (
                <label
                  className={(draft || []).includes(o.id) ? "chosen" : ""}
                  key={o.id}
                >
                  <input
                    type={q.type === "MSQ" ? "checkbox" : "radio"}
                    name="response"
                    disabled={locked}
                    checked={(draft || []).includes(o.id)}
                    onChange={(e) =>
                      setDraft(
                        q.type === "MSQ"
                          ? e.target.checked
                            ? [...(draft || []), o.id]
                            : (draft || []).filter((v) => v !== o.id)
                          : [o.id],
                      )
                    }
                  />
                  <span className="option-letter">{o.id}</span>
                  <span>{o.text}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="exam-actions">
            <button
              className="secondary"
              disabled={locked || index === 0}
              onClick={() => move(index - 1)}
            >
              Previous
            </button>
            <button
              className="secondary"
              disabled={locked}
              onClick={() => save(!answer?.review)}
            >
              {answer?.review ? "Remove review" : "Mark for review"}
            </button>
            <button
              className="secondary"
              disabled={locked}
              onClick={async () => {
                if (await save(undefined, null)) setDraft(null);
              }}
            >
              Clear
            </button>
            <button
              disabled={locked}
              onClick={() =>
                move(Math.min(index + 1, attempt.questions.length - 1))
              }
            >
              {index === attempt.questions.length - 1
                ? "Save response"
                : "Save & next →"}
            </button>
          </div>
          <small className="muted">
            Responses are saved when you navigate, review, clear or submit.
            Unsaved edits are not included after the deadline.
          </small>
        </section>
        <aside className="panel palette-panel">
          <h2>Question palette</h2>
          <div className="palette">
            {attempt.questions.map((item, i) => (
              <button
                key={item.id}
                disabled={locked}
                className={`${state(answers[item.id])} ${index === i ? "current" : ""}`}
                aria-label={`Question ${i + 1}, ${state(answers[item.id])}`}
                aria-current={index === i ? "true" : undefined}
                onClick={() => move(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <div className="palette-key">
            <span>● Answered</span>
            <span>○ Not answered</span>
            <span>◆ Marked for review</span>
          </div>
          <button disabled={locked} onClick={submit}>
            Submit examination
          </button>
          <details>
            <summary>Examination instructions</summary>
            <p>{attempt.instructions}</p>
          </details>
        </aside>
      </div>
      {confirmation}
    </main>
  );
}
