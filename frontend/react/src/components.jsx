import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export function Notice({ message }) {
  return message ? (
    <div className={`notice ${message.kind || ""}`} role="status">
      {message.text || message}
    </div>
  ) : null;
}
export function Password({ name, label, value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="password">
        <input
          name={name}
          type={show ? "text" : "password"}
          autoComplete="current-password"
          required
          value={value || ""}
          onChange={onChange}
        />
        <button
          type="button"
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow(!show)}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}
export function Modal({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}
export function Form({
  fields,
  initial = {},
  onSubmit,
  button = "Save",
  onCancel,
  onValuesChange,
}) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      fields.map((f) => [f.name, initial[f.name] ?? f.value ?? ""]),
    ),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit(values);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        {fields.map((f) => {
          const change = (e) => {
            const next = { ...values, [f.name]: e.target.value };
            setValues(next);
            onValuesChange?.(next);
          };
          const options =
            typeof f.options === "function" ? f.options(values) : f.options;
          return f.type === "password" ? (
            <Password
              key={f.name}
              {...f}
              value={values[f.name]}
              onChange={change}
            />
          ) : (
            <label className={`field ${f.wide ? "wide" : ""}`} key={f.name}>
              <span>{f.label}</span>
              {f.type === "textarea" ? (
                <textarea
                  name={f.name}
                  value={values[f.name]}
                  onChange={change}
                  required={f.required !== false}
                  rows="3"
                />
              ) : options ? (
                <select
                  name={f.name}
                  value={String(values[f.name])}
                  onChange={change}
                  required={f.required !== false}
                >
                  {!f.noBlank && (
                    <option value="">Select {f.label.toLowerCase()}</option>
                  )}
                  {options.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={f.name}
                  type={f.type || "text"}
                  value={values[f.name]}
                  onChange={change}
                  required={f.required !== false}
                  min={f.min}
                  max={f.max}
                  step={f.type === "number" ? "any" : undefined}
                  autoComplete={f.autoComplete}
                />
              )}{" "}
              {f.help && <small>{f.help}</small>}
            </label>
          );
        })}
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button disabled={busy} type="submit">
          {busy ? "Saving…" : button}
        </button>
      </div>
    </form>
  );
}
export const field = (name, label, type = "text", options, extra = {}) => ({
  name,
  label,
  type,
  options,
  ...extra,
});
export const yesNo = [
  { value: true, label: "Yes" },
  { value: false, label: "No" },
];
export const choices = (items) =>
  items.map((value) => ({ value, label: value }));
export function Status({ value }) {
  return (
    <span
      className={`status status-${String(value).toLowerCase().replaceAll(" ", "-")}`}
    >
      {String(value ?? "—")}
    </span>
  );
}
export function Table({ rows, columns, actions }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label || c.key.replaceAll("_", " ")}</th>
            ))}
            {actions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={r.id || i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(r[c.key], r) : String(r[c.key] ?? "—")}
                  </td>
                ))}
                {actions && (
                  <td>
                    <div className="row-actions">{actions(r)}</div>
                  </td>
                )}
              </tr>
            ))
          ) : (
            <tr>
              <td
                colSpan={columns.length + (actions ? 1 : 0)}
                className="empty"
              >
                No records to display.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function useConfirm() {
  const [request, setRequest] = useState(null);
  const ask = (body) => new Promise((resolve) => setRequest({ body, resolve }));
  const close = (value) => {
    request.resolve(value);
    setRequest(null);
  };
  return [
    ask,
    request ? (
      <Modal title="Please confirm" onClose={() => close(false)}>
        <p>{request.body}</p>
        <div className="form-actions">
          <button className="secondary" onClick={() => close(false)}>
            Cancel
          </button>
          <button onClick={() => close(true)}>Confirm</button>
        </div>
      </Modal>
    ) : null,
  ];
}
