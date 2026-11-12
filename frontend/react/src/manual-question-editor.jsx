import React from "react";

const letters = "ABCDEFGH".split("");
export const newManualQuestion = (number) => ({
  number,
  prompt: "",
  options: letters.slice(0, 4).map((id) => ({ id, text: "" })),
  answer: null,
  marks: 1,
  negativeMarks: 0,
  media: [],
  slides: [],
});

export function ManualQuestionEditor({
  document,
  onChange,
  disabled,
  readonly,
}) {
  const modify = (index, changes) =>
    onChange((d) => ({
      ...d,
      questions: d.questions.map((q, i) =>
        i === index ? { ...q, ...changes } : q,
      ),
    }));
  return (
    <section className="manual-paper-editor">
      <section className="panel">
        <h2>Type your questions</h2>
        <p>
          Enter each question, its answer options and the correct answer. Set
          the marks, then save your draft.
        </p>
        {!document.questions.length && (
          <p className="muted">Start with your first question below.</p>
        )}
      </section>
      {document.questions.map((q, i) => (
        <section className="panel question-editor" key={i}>
          <div className="section-heading">
            <h2>Question {q.number}</h2>
            {!readonly && (
              <button
                className="danger"
                disabled={disabled}
                onClick={() =>
                  onChange((d) => ({
                    ...d,
                    questions: d.questions
                      .filter((_, n) => n !== i)
                      .map((item, n) => ({ ...item, number: n + 1 })),
                  }))
                }
              >
                Remove question {q.number}
              </button>
            )}
          </div>
          <label className="field">
            <span>Question text</span>
            <textarea
              rows="4"
              maxLength={10000}
              disabled={disabled || readonly}
              value={q.prompt}
              onChange={(e) => modify(i, { prompt: e.target.value })}
              placeholder="Type the full question here"
            />
          </label>
          {q.options.map((o, n) => (
            <div className="paper-option" key={o.id}>
              <label className="field">
                <span>Option {o.id}</span>
                <textarea
                  rows="2"
                  maxLength={2000}
                  disabled={disabled || readonly}
                  value={o.text}
                  onChange={(e) =>
                    modify(i, {
                      options: q.options.map((v, j) =>
                        j === n ? { ...v, text: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}
          {!readonly && (
            <div className="row-actions">
              <button
                className="secondary"
                disabled={disabled || q.options.length >= 8}
                onClick={() =>
                  modify(i, {
                    options: [
                      ...q.options,
                      { id: letters[q.options.length], text: "" },
                    ],
                  })
                }
              >
                Add option
              </button>
              <button
                className="secondary"
                disabled={disabled || q.options.length <= 2}
                onClick={() => {
                  const options = q.options.slice(0, -1);
                  modify(i, {
                    options,
                    answer: options.some((o) => o.id === q.answer)
                      ? q.answer
                      : null,
                  });
                }}
              >
                Remove last option
              </button>
            </div>
          )}
          <div className="paper-question-controls">
            <label className="field">
              <span>Correct answer</span>
              <select
                disabled={disabled || readonly}
                value={q.answer || ""}
                onChange={(e) => modify(i, { answer: e.target.value || null })}
              >
                <option value="">Choose answer</option>
                {q.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    Option {o.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Marks</span>
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                disabled={disabled || readonly}
                value={q.marks}
                onChange={(e) => modify(i, { marks: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Negative marks</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                disabled={disabled || readonly}
                value={q.negativeMarks}
                onChange={(e) =>
                  modify(i, { negativeMarks: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </section>
      ))}
      {!readonly && (
        <button
          disabled={disabled || document.questions.length >= 300}
          onClick={() =>
            onChange((d) => ({
              ...d,
              questions: [
                ...d.questions,
                newManualQuestion(d.questions.length + 1),
              ],
            }))
          }
        >
          Add question
        </button>
      )}
    </section>
  );
}
