import React, { useEffect, useState } from "react";
import { api, upload, dateText } from "./api.js";
import { Notice, useConfirm } from "./components.jsx";
import logo from "./assets/exampro-logo.jpeg";
import "./examiner.css";
const tabs = [
  "Overview",
  "Create Question Paper",
  "Draft Question Papers",
  "Published Question Papers",
  "Assigned Examinations",
];
const letters = "ABCDEFGH".split("");
const metadata = (p) => ({
  title: p.title,
  subject: p.subject,
  description: p.description,
  durationMinutes: Number(p.duration_minutes),
  totalMarks: Number(p.total_marks),
});
function Figures({ media = [] }) {
  return media.map((m, i) => (
    <img
      className="question-media"
      key={i}
      src={`data:${m.mime};base64,${m.data}`}
      alt={`Slide figure ${i + 1}`}
    />
  ));
}
export function Examiner({ user, navigate }) {
  const [view, setView] = useState("Overview"),
    [exams, setExams] = useState([]),
    [papers, setPapers] = useState([]),
    [paperPage, setPaperPage] = useState(1),
    [paperCount, setPaperCount] = useState(0),
    [counts, setCounts] = useState({ draft: 0, published: 0 }),
    [paper, setPaper] = useState(null),
    [doc, setDoc] = useState(null),
    [details, setDetails] = useState(null),
    [selection, setSelection] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(null),
    [file, setFile] = useState(null),
    [bulk, setBulk] = useState(""),
    [editorTab, setEditorTab] = useState("Upload PPT/PPTX"),
    [dirty, setDirty] = useState(false);
  const [ask, confirmation] = useConfirm();
  const reload = async () => {
    const [e, p] = await Promise.all([
      api("/examiner/examinations"),
      api(
        "/examiner/papers?page=" +
          paperPage +
          (view === "Draft Question Papers"
            ? "&status=draft"
            : view === "Published Question Papers"
              ? "&status=published"
              : ""),
      ),
    ]);
    setExams(e);
    setPapers(p.items);
    setCounts(p.counts);
    setPaperCount(p.total);
  };
  useEffect(() => {
    reload()
      .catch((e) => setNotice({ text: e.message, kind: "error" }))
      .finally(() => setLoading(false));
  }, [view, paperPage]);
  useEffect(() => {
    const prevent = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({ text: e.message, kind: "error" });
      if (e.status === 401 && !dirty) navigate("/examiner-login");
    } finally {
      setBusy(false);
    }
  };
  const open = async (id) => {
    const p = await api("/examiner/papers/" + id);
    setPaper(p);
    setDetails(metadata(p));
    setDoc(
      typeof p.document === "string" ? JSON.parse(p.document) : p.document,
    );
    setFile(null);
    setBulk("");
    setDirty(false);
    setEditorTab("Upload PPT/PPTX");
  };
  const changeView = async (v) => {
    if (
      dirty &&
      !(await ask(
        "Discard unsaved preview changes? Save the draft first to retain them.",
      ))
    )
      return;
    setPaper(null);
    setDoc(null);
    setDirty(false);
    setView(v);
    setPaperPage(1);
    setNotice(null);
    if (v === "Create Question Paper") {
      setSelection(exams[0]?.id || "");
      setDetails({
        title: exams[0]?.name || "",
        subject: "",
        description: "",
        durationMinutes: exams[0]?.duration_minutes || 60,
        totalMarks: 1,
      });
    }
  };
  const modify = (i, changes) => {
    setDoc((d) => ({
      ...d,
      reviewed: false,
      questions: d.questions.map((q, n) =>
        n === i ? { ...q, ...changes } : q,
      ),
    }));
    setDirty(true);
  };
  const save = async () => {
    const r = await api("/examiner/papers/" + paper.id, "PUT", {
      ...details,
      document: doc,
      expectedRevision: paper.revision,
    });
    setPaper((p) => ({ ...p, ...details, revision: r.revision }));
    setDirty(false);
    return r.revision;
  };
  const input = (key, label, type = "text") => (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        step={type === "number" ? "any" : undefined}
        required
        value={details?.[key] ?? ""}
        disabled={busy || paper?.status === "published"}
        onChange={(e) => {
          setDetails((d) => ({
            ...d,
            [key]: type === "number" ? Number(e.target.value) : e.target.value,
          }));
          setDirty(true);
        }}
      />
    </label>
  );
  const readonly = paper?.status === "published";
  const missing =
    doc?.questions.filter(
      (q) => !q.answer || !q.options.some((o) => o.id === q.answer),
    ).length || 0;
  return (
    <div className="workspace role-examiner">
      <aside className="sidebar">
        <div className="sidebar-title">
          <img
            src={logo}
            className="sidebar-logo"
            alt="EXAMPRO Examination Portal logo"
          />
        </div>
        <p className="eyebrow">Examiner workspace</p>
        <nav>
          {tabs.map((t) => (
            <button
              className={view === t ? "selected" : ""}
              key={t}
              onClick={() => run(() => changeView(t))}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          Question papers are private to their assigned examiner. Published
          papers are locked.
        </div>
      </aside>
      <main className="workspace-main">
        <div className="section-heading">
          <div>
            <p className="eyebrow">EXAMPRO / Examiner</p>
            <h1>{paper ? paper.title : view}</h1>
            <p className="muted">
              {paper
                ? `${paper.status} · Revision ${paper.revision}`
                : `Welcome, ${user.name}. Prepare papers for your assigned examinations.`}
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => run(reload)}
          >
            Refresh lists
          </button>
        </div>
        <Notice message={notice} />
        {loading ? (
          <p role="status">Loading assigned examinations…</p>
        ) : (
          <>
            {!paper && view === "Overview" && (
              <>
                <div className="metrics">
                  <div>
                    <span>Assigned examinations</span>
                    <strong>{exams.length}</strong>
                  </div>
                  <div>
                    <span>Draft papers</span>
                    <strong>{counts.draft}</strong>
                  </div>
                  <div>
                    <span>Published papers</span>
                    <strong>{counts.published}</strong>
                  </div>
                </div>
                <section className="panel">
                  <h2>Prepare a question paper</h2>
                  <ol>
                    <li>
                      Select an examination assigned by the administrator.
                    </li>
                    <li>
                      Upload PowerPoint slides with numbered MCQs and lettered
                      options.
                    </li>
                    <li>
                      Verify every slide and enter the correct answers yourself.
                    </li>
                    <li>Save a draft, then publish the verified paper.</li>
                  </ol>
                  <button
                    onClick={() =>
                      run(() => changeView("Create Question Paper"))
                    }
                  >
                    Create Question Paper
                  </button>
                </section>
              </>
            )}
            {!paper && view === "Assigned Examinations" && (
              <section className="panel">
                <table>
                  <thead>
                    <tr>
                      <th>Examination</th>
                      <th>Duration</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exams.map((e) => (
                      <tr key={e.id}>
                        <td>{e.name}</td>
                        <td>{e.duration_minutes} min</td>
                        <td>{e.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!exams.length && (
                  <p>
                    No examinations are assigned yet. Ask your administrator to
                    assign one.
                  </p>
                )}
              </section>
            )}
            {!paper &&
              ["Draft Question Papers", "Published Question Papers"].includes(
                view,
              ) && (
                <section className="panel">
                  <div className="paper-list">
                    {papers
                      .filter(
                        (p) =>
                          p.status ===
                          (view.startsWith("Draft") ? "draft" : "published"),
                      )
                      .map((p) => (
                        <article className="panel" key={p.id}>
                          <h2>{p.title}</h2>
                          <p>
                            {p.exam_name} · {p.subject}
                          </p>
                          <p className="muted">
                            Updated {dateText(p.updated_at)}
                          </p>
                          <div className="row-actions">
                            <button
                              disabled={busy}
                              onClick={() => run(() => open(p.id))}
                            >
                              Open {p.status === "draft" ? "draft" : "paper"}
                            </button>
                            {p.status === "draft" && (
                              <button
                                className="danger"
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    if (
                                      await ask(
                                        "Permanently delete this draft and its uploaded source?",
                                      )
                                    ) {
                                      await api(
                                        "/examiner/papers/" + p.id,
                                        "DELETE",
                                      );
                                      await reload();
                                    }
                                  })
                                }
                              >
                                Delete draft
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                  </div>
                  {!papers.some(
                    (p) =>
                      p.status ===
                      (view.startsWith("Draft") ? "draft" : "published"),
                  ) && <p>No papers in this list.</p>}
                  <div className="row-actions">
                    <button
                      className="secondary"
                      disabled={busy || paperPage === 1}
                      onClick={() => setPaperPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <span>
                      Page {paperPage} · {paperCount} papers
                    </span>
                    <button
                      className="secondary"
                      disabled={busy || paperPage * 25 >= paperCount}
                      onClick={() => setPaperPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </section>
              )}
            {!paper && view === "Create Question Paper" && (
              <section className="panel">
                {!exams.length ? (
                  <p>
                    No examinations are assigned yet. Ask your administrator to
                    assign one.
                  </p>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(async () => {
                        const created = await api("/examiner/papers", "POST", {
                          examId: selection,
                          ...details,
                        });
                        await open(created.id);
                        await reload();
                      });
                    }}
                  >
                    <div className="form-grid">
                      <label className="field">
                        <span>Assigned examination</span>
                        <select
                          required
                          value={selection}
                          onChange={(e) => {
                            setSelection(e.target.value);
                            const exam = exams.find(
                              (x) => x.id === e.target.value,
                            );
                            setDetails((d) => ({
                              ...d,
                              title: exam.name,
                              durationMinutes: exam.duration_minutes,
                            }));
                          }}
                        >
                          {exams.map((e) => (
                            <option value={e.id} key={e.id}>
                              {e.name} · {e.status}
                            </option>
                          ))}
                        </select>
                      </label>
                      {input("title", "Question paper title")}
                      {input("subject", "Subject")}
                      {input("description", "Description")}
                      {input(
                        "durationMinutes",
                        "Duration (must match assigned exam)",
                        "number",
                      )}
                      {input("totalMarks", "Total marks", "number")}
                    </div>
                    <div className="form-actions">
                      <button disabled={busy}>Create draft</button>
                    </div>
                  </form>
                )}
              </section>
            )}
            {paper && doc && (
              <>
                <section className="panel">
                  <div className="form-grid">
                    {input("title", "Question paper title")}
                    {input("subject", "Subject")}
                    {input("description", "Description")}
                    {input("durationMinutes", "Duration (minutes)", "number")}
                    {input("totalMarks", "Total marks", "number")}
                  </div>
                  <div className="paper-editor-tabs">
                    {[
                      "Upload PPT/PPTX",
                      "Question Preview",
                      "Answer Key Entry",
                    ].map((t) => (
                      <button
                        className={editorTab === t ? "" : "secondary"}
                        key={t}
                        onClick={() => setEditorTab(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </section>
                {editorTab === "Upload PPT/PPTX" && (
                  <section className="panel">
                    <h2>Upload question slides</h2>
                    <p>
                      Use one numbered question per slide, for example “Question
                      1: …”, with options “A) …”, “B) …”. Clear continuations
                      may span slides. Correct answers are never inferred.
                    </p>
                    <p className="muted">
                      Maximum 3 MB and 300 slides. PNG/JPEG figures are
                      supported; scanned slides, charts and ambiguous layouts
                      are flagged for review. Legacy PPT needs a configured
                      converter; use Save As PPTX on Vercel.
                    </p>
                    {!readonly && (
                      <>
                        <input
                          aria-label="PowerPoint question paper"
                          type="file"
                          accept=".pptx,.ppt"
                          disabled={busy}
                          onChange={(e) => setFile(e.target.files[0] || null)}
                        />
                        <button
                          className="upload-paper-button"
                          disabled={busy || !file}
                          onClick={() =>
                            run(async () => {
                              if (file.size > 3 * 1024 * 1024)
                                throw new Error(
                                  "The PowerPoint must be no larger than 3 MB.",
                                );
                              if (
                                doc.questions.length &&
                                !(await ask(
                                  "Replace the current extraction and manually entered key with this upload?",
                                ))
                              )
                                return;
                              const revision = dirty
                                ? await save()
                                : paper.revision;
                              const p = await upload(
                                `/examiner/papers/${paper.id}/upload?filename=${encodeURIComponent(file.name)}&revision=${revision}`,
                                file,
                              );
                              setPaper(p);
                              setDetails(metadata(p));
                              setDoc(p.document);
                              setDirty(false);
                              setEditorTab("Question Preview");
                              await reload();
                            })
                          }
                        >
                          {busy ? "Processing…" : "Upload and extract"}
                        </button>
                      </>
                    )}
                    {paper.source_name && (
                      <p>
                        Source:{" "}
                        <a href={`/api/examiner/papers/${paper.id}/source`}>
                          {paper.source_name}
                        </a>
                      </p>
                    )}
                    <p>
                      {doc.slideCount} slides · {doc.questions.length} extracted
                      questions · {doc.issues.length} review issues
                    </p>
                  </section>
                )}
                {editorTab === "Question Preview" && (
                  <>
                    <section className="panel">
                      <h2>Verify extracted content</h2>
                      <p>
                        Compare the original slide text and figures below with
                        every question. Correct any omissions before entering
                        the answer key.
                      </p>
                      {doc.slides && (
                        <details>
                          <summary>
                            Original extracted slide content (
                            {doc.slides.length})
                          </summary>
                          {doc.slides.map((s) => (
                            <article className="slide-preview" key={s.number}>
                              <h3>Slide {s.number}</h3>
                              <pre>{s.lines.join("\n")}</pre>
                              <Figures media={s.media} />
                            </article>
                          ))}
                        </details>
                      )}
                      {doc.issues.map((issue, i) => (
                        <label className="field paper-issue" key={i}>
                          <span>
                            Slide {issue.slide}: {issue.message}
                          </span>
                          <textarea
                            disabled={readonly || busy}
                            placeholder="Explain how you corrected or explicitly excluded this content"
                            value={doc.resolutions[String(i)] || ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setDoc((d) => ({
                                ...d,
                                reviewed: false,
                                resolutions: { ...d.resolutions, [i]: value },
                              }));
                              setDirty(true);
                            }}
                          />
                        </label>
                      ))}
                    </section>
                    {doc.questions.map((q, i) => (
                      <section className="panel question-editor" key={i}>
                        <h2>Question {q.number}</h2>
                        <div className="paper-question-controls">
                          <label className="field">
                            <span>Question number</span>
                            <input
                              type="number"
                              min="1"
                              disabled={readonly || busy}
                              value={q.number}
                              onChange={(e) =>
                                modify(i, { number: Number(e.target.value) })
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Marks</span>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              disabled={readonly || busy}
                              value={q.marks}
                              onChange={(e) =>
                                modify(i, { marks: Number(e.target.value) })
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Negative marks</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              disabled={readonly || busy}
                              value={q.negativeMarks}
                              onChange={(e) =>
                                modify(i, {
                                  negativeMarks: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        </div>
                        <label className="field">
                          <span>Question text</span>
                          <textarea
                            disabled={readonly || busy}
                            value={q.prompt}
                            onChange={(e) =>
                              modify(i, { prompt: e.target.value })
                            }
                          />
                        </label>
                        <Figures media={q.media} />
                        {!readonly && (
                          <label className="field">
                            <span>Attach figures from original slide</span>
                            <select
                              value=""
                              disabled={busy}
                              onChange={(e) => {
                                const slide = doc.slides?.find(
                                  (s) => s.number === Number(e.target.value),
                                );
                                if (slide) modify(i, { media: slide.media });
                              }}
                            >
                              <option value="">
                                Choose a slide to replace this question’s
                                figures
                              </option>
                              {(doc.slides || [])
                                .filter((s) => s.media.length)
                                .map((s) => (
                                  <option key={s.number} value={s.number}>
                                    Slide {s.number}
                                  </option>
                                ))}
                            </select>
                          </label>
                        )}
                        {q.options.map((o, j) => (
                          <div className="paper-option" key={j}>
                            <select
                              aria-label={`Question ${q.number} option ${j + 1} letter`}
                              disabled={readonly || busy}
                              value={o.id}
                              onChange={(e) =>
                                modify(i, {
                                  options: q.options.map((v, k) =>
                                    k === j ? { ...v, id: e.target.value } : v,
                                  ),
                                })
                              }
                            >
                              {letters.map((l) => (
                                <option key={l}>{l}</option>
                              ))}
                            </select>
                            <textarea
                              aria-label={`Question ${q.number} option ${o.id}`}
                              disabled={readonly || busy}
                              value={o.text}
                              onChange={(e) =>
                                modify(i, {
                                  options: q.options.map((v, k) =>
                                    k === j
                                      ? { ...v, text: e.target.value }
                                      : v,
                                  ),
                                })
                              }
                            />
                            {!readonly && (
                              <button
                                className="danger"
                                aria-label={`Remove option ${o.id}`}
                                onClick={() =>
                                  modify(i, {
                                    options: q.options.filter(
                                      (_, k) => k !== j,
                                    ),
                                    answer: null,
                                  })
                                }
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                        {!readonly && (
                          <div className="row-actions">
                            <button
                              className="secondary"
                              disabled={q.options.length >= 8 || busy}
                              onClick={() =>
                                modify(i, {
                                  options: [
                                    ...q.options,
                                    {
                                      id:
                                        letters.find(
                                          (l) =>
                                            !q.options.some((o) => o.id === l),
                                        ) || "H",
                                      text: "",
                                    },
                                  ],
                                })
                              }
                            >
                              Add option
                            </button>
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() => {
                                setDoc((d) => ({
                                  ...d,
                                  reviewed: false,
                                  questions: d.questions.filter(
                                    (_, n) => n !== i,
                                  ),
                                }));
                                setDirty(true);
                              }}
                            >
                              Remove question
                            </button>
                          </div>
                        )}
                      </section>
                    ))}
                    {!readonly && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setDoc((d) => ({
                            ...d,
                            reviewed: false,
                            questions: [
                              ...d.questions,
                              {
                                number:
                                  Math.max(
                                    0,
                                    ...d.questions.map((q) => q.number),
                                  ) + 1,
                                prompt: "",
                                options: ["A", "B", "C", "D"].map((id) => ({
                                  id,
                                  text: "",
                                })),
                                answer: null,
                                marks: 1,
                                negativeMarks: 0,
                                media: [],
                                slides: [],
                              },
                            ],
                          }));
                          setDirty(true);
                        }}
                      >
                        Add missing/transcribed question
                      </button>
                    )}
                  </>
                )}
                {editorTab === "Answer Key Entry" && (
                  <section className="panel">
                    <h2>Manual answer key</h2>
                    <p>
                      {missing} questions still need an answer. Only the
                      examiner supplies the correct answers.
                    </p>
                    {doc.questions.map((q, i) => (
                      <fieldset className="manual-key" key={i}>
                        <legend>
                          Question {q.number}: {q.prompt.slice(0, 120)}
                        </legend>
                        {q.options.map((o) => (
                          <label key={o.id}>
                            <input
                              type="radio"
                              name={`key-${i}`}
                              disabled={readonly || busy}
                              checked={q.answer === o.id}
                              onChange={() => modify(i, { answer: o.id })}
                            />
                            {o.id}
                          </label>
                        ))}
                      </fieldset>
                    ))}
                    {!readonly && (
                      <>
                        <label className="field">
                          <span>
                            Bulk answer key (one numbered answer per line)
                          </span>
                          <textarea
                            rows="5"
                            placeholder={"1) B\n2) B\n3) A"}
                            value={bulk}
                            onChange={(e) => setBulk(e.target.value)}
                          />
                        </label>
                        <button
                          className="secondary"
                          disabled={busy || !bulk.trim()}
                          onClick={() =>
                            run(async () => {
                              await save();
                              const key = await api(
                                `/examiner/papers/${paper.id}/key`,
                                "POST",
                                { text: bulk },
                              );
                              setDoc((d) => ({
                                ...d,
                                reviewed: false,
                                questions: d.questions.map((q) => ({
                                  ...q,
                                  answer: key[q.number] || q.answer,
                                })),
                              }));
                              setDirty(true);
                              setNotice({
                                text: "Bulk answers applied. Check unanswered questions and save the draft.",
                              });
                            })
                          }
                        >
                          Apply bulk answers
                        </button>
                      </>
                    )}
                  </section>
                )}
                <section className="panel paper-save-bar">
                  <p>
                    {doc.questions.length} questions · {missing} unanswered ·{" "}
                    {doc.questions.reduce((s, q) => s + q.marks, 0)} /{" "}
                    {details.totalMarks} marks
                    {dirty ? " · Unsaved changes" : ""}
                  </p>
                  {!readonly && (
                    <>
                      <label className="review-confirm">
                        <input
                          type="checkbox"
                          checked={doc.reviewed}
                          disabled={busy}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setDoc((d) => ({ ...d, reviewed: checked }));
                            setDirty(true);
                          }}
                        />
                        I verified every slide, question, option, review issue
                        and answer key.
                      </label>
                      <div className="row-actions">
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await save();
                              await reload();
                              setNotice({ text: "Draft saved." });
                            })
                          }
                        >
                          {busy ? "Saving…" : "Save draft"}
                        </button>
                        <button
                          disabled={
                            busy ||
                            !doc.questions.length ||
                            missing > 0 ||
                            !doc.reviewed
                          }
                          onClick={() =>
                            run(async () => {
                              if (
                                !(await ask(
                                  "Publish this paper? Its questions and answer key will be locked.",
                                ))
                              )
                                return;
                              const revision = await save();
                              const r = await api(
                                `/examiner/papers/${paper.id}/publish`,
                                "POST",
                                { expectedRevision: revision },
                              );
                              await open(paper.id);
                              await reload();
                              setNotice({ text: r.message });
                            })
                          }
                        >
                          Publish question paper
                        </button>
                      </div>
                    </>
                  )}
                </section>
              </>
            )}
          </>
        )}
        {confirmation}
      </main>
    </div>
  );
}
