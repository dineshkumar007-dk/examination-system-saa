import React, { useState } from "react";
import { dateText } from "./api.js";
import { Avatar, Icon } from "./illustrations.jsx";

const date = (v) =>
  v
    ? new Date(
        String(v).replace(" ", "T") + (String(v).endsWith("Z") ? "" : "Z"),
      )
    : null;
const finished = (r) =>
  r.attempt_status === "submitted" || r.status === "completed";
const cancelled = (r) =>
  r.status === "cancelled" || r.exam_deleted_at || r.slot_deleted_at;
const day = (v) =>
  date(v)?.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }) || "Slot not allocated";
const time = (v) =>
  date(v)?.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  }) || "";
const sameDay = (a, b) => a && b && a.toDateString() === b.toDateString();

function Calendar({ rows }) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const today = new Date(),
    days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const move = (n) =>
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <section className="dashboard-panel calendar-panel">
      <div className="panel-heading">
        <h3>
          {month.toLocaleDateString("en-IN", {
            month: "long",
            year: "numeric",
          })}
        </h3>
        <div className="calendar-controls">
          <button aria-label="Previous month" onClick={() => move(-1)}>
            ‹
          </button>
          <button aria-label="Next month" onClick={() => move(1)}>
            ›
          </button>
        </div>
      </div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((v) => (
          <small key={v}>{v}</small>
        ))}
        {Array.from({ length: month.getDay() }, (_, i) => (
          <span key={`blank${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = new Date(month.getFullYear(), month.getMonth(), i + 1),
            exam = rows.some(
              (r) => !cancelled(r) && sameDay(date(r.starts_at), d),
            );
          return (
            <span
              key={i}
              className={`${sameDay(d, today) ? "today" : ""} ${exam ? "exam-day" : ""}`}
              title={exam ? "Scheduled examination" : undefined}
            >
              {i + 1}
            </span>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span>
          <i />
          Today
        </span>
        <span>
          <i />
          Exam day
        </span>
      </div>
    </section>
  );
}

export function CandidateDashboard({ user, profile, rows, onView, navigate }) {
  const [filter, setFilter] = useState("All"),
    [search, setSearch] = useState("");
  const upcoming = rows.filter(
    (r) =>
      !cancelled(r) &&
      !finished(r) &&
      (!r.ends_at || date(r.ends_at) > new Date()),
  );
  const completed = rows.filter((r) => !cancelled(r) && finished(r));
  const shown = (
    filter === "Upcoming" ? upcoming : filter === "Completed" ? completed : rows
  ).filter((r) =>
    `${r.exam_name} ${r.hall_number || ""} ${r.registration_number}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const today = upcoming.filter((r) => sameDay(date(r.starts_at), new Date()));
  const allocated = upcoming.filter((r) => r.hall_number);
  const gender = profile?.gender ?? user.gender;
  const tasks = [
    ...allocated
      .slice(0, 2)
      .map((r) => ({
        r,
        icon: "ticket",
        title: "Download hall ticket",
        text: r.exam_name,
        kind: "yellow",
        link: true,
      })),
    ...upcoming
      .slice(0, 2)
      .map((r) => ({
        r,
        icon: "file",
        title: "Review exam instructions",
        text: r.exam_name,
        kind: "lavender",
      })),
  ].slice(0, 4);
  return (
    <div className="candidate-layout">
      <div className="candidate-primary">
        <header className="dashboard-greeting">
          <div>
            <h1>
              Hello, <span>{user.name.split(" ")[0]}</span>{" "}
              <span className="wave" aria-hidden="true">
                ✦
              </span>
            </h1>
            <p>Good luck with your upcoming examinations!</p>
          </div>
          <label className="dashboard-search">
            <Icon name="search" />
            <input
              aria-label="Search my examinations"
              placeholder="Search examinations, hall tickets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            className="notification-button"
            aria-label="Open notifications"
            onClick={() => onView("Notifications")}
          >
            <Icon name="bell" />
          </button>
        </header>
        <section className="my-exams">
          <div className="panel-heading">
            <h2>My Examinations</h2>
            <button
              className="text-button"
              onClick={() => onView("My registrations")}
            >
              View all <Icon name="arrow" size={17} />
            </button>
          </div>
          <div className="dashboard-tabs">
            {["All", "Upcoming", "Completed"].map((v) => (
              <button
                key={v}
                className={filter === v ? "active" : ""}
                onClick={() => setFilter(v)}
              >
                {v} (
                {v === "All"
                  ? rows.length
                  : v === "Upcoming"
                    ? upcoming.length
                    : completed.length}
                )
              </button>
            ))}
          </div>
          <div className="exam-card-grid">
            {shown.slice(0, 6).map((r, i) => (
              <article
                key={r.id}
                className={`dashboard-exam-card ${cancelled(r) ? "cancelled-card" : ""}`}
              >
                <div className="exam-card-title">
                  <span className={`icon-disc tint-${i % 3}`}>
                    <Icon
                      name={
                        i % 3 === 0 ? "monitor" : i % 3 === 1 ? "file" : "chart"
                      }
                      size={27}
                    />
                  </span>
                  <div>
                    <h3>{r.exam_name}</h3>
                    <small>{r.hall_number || "Awaiting hall ticket"}</small>
                    <span
                      className={`exam-badge ${finished(r) ? "complete" : r.attempt_status === "in_progress" ? "progress" : ""}`}
                    >
                      {cancelled(r)
                        ? "Cancelled"
                        : finished(r)
                          ? "Completed"
                          : r.attempt_status === "in_progress"
                            ? "In progress"
                            : r.starts_at
                              ? "Scheduled"
                              : "Registered"}
                    </span>
                  </div>
                </div>
                <div className="exam-card-details">
                  <p>
                    <Icon name="calendar" size={18} />
                    {day(r.starts_at)}
                  </p>
                  <p>
                    <Icon name="clock" size={18} />
                    {r.starts_at
                      ? `${time(r.starts_at)} – ${time(r.ends_at)}`
                      : "Time pending allocation"}
                  </p>
                  <p>
                    <Icon name="pin" size={18} />
                    <span>
                      {r.center_name || "Center pending allocation"}
                      <small>
                        {r.computer_label
                          ? `Workstation ${r.computer_label}`
                          : "Computer assigned by invigilator"}
                      </small>
                    </span>
                  </p>
                </div>
                <button
                  className={`card-action ${finished(r) ? "green" : ""}`}
                  onClick={() =>
                    r.attempt_status === "in_progress"
                      ? navigate("/exam")
                      : onView(finished(r) ? "Results" : "My registrations")
                  }
                >
                  {finished(r)
                    ? "View result"
                    : r.attempt_status === "in_progress"
                      ? "Continue exam"
                      : "View details"}
                  <Icon name="arrow" size={18} />
                </button>
              </article>
            ))}
          </div>
          {!shown.length && (
            <div className="dashboard-panel empty">
              <Icon name="file" size={32} />
              <h3>
                {search
                  ? "No matching examinations"
                  : "Your examinations will appear here"}
              </h3>
              <p>
                {search
                  ? "Try another examination name or hall-ticket number."
                  : "Browse available examinations to start your first registration."}
              </p>
              {!search && (
                <button onClick={() => onView("Examinations")}>
                  Browse examinations <Icon name="arrow" size={17} />
                </button>
              )}
            </div>
          )}
        </section>
        <section>
          <div className="panel-heading">
            <h2>Upcoming Tasks</h2>
            <button
              className="text-button"
              onClick={() => onView("My registrations")}
            >
              View all <Icon name="arrow" size={17} />
            </button>
          </div>
          <div className="task-grid">
            {tasks.map((t, i) => (
              <article className={`task-card ${t.kind}`} key={`${t.r.id}-${i}`}>
                <span className="icon-disc">
                  <Icon name={t.icon} />
                </span>
                <div>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                  <small>
                    <Icon name="calendar" size={15} />
                    {day(t.r.starts_at)}
                  </small>
                </div>
                {t.link ? (
                  <a
                    className="round-action"
                    href={`/api/hall-ticket/${t.r.allocation_id}`}
                    aria-label={`Download hall ticket for ${t.r.exam_name}`}
                  >
                    <Icon name="arrow" size={18} />
                  </a>
                ) : (
                  <button
                    className="round-action"
                    aria-label={`View instructions for ${t.r.exam_name}`}
                    onClick={() => onView("My registrations")}
                  >
                    <Icon name="arrow" size={18} />
                  </button>
                )}
              </article>
            ))}
          </div>
          {!tasks.length && (
            <div className="dashboard-panel quiet-empty">
              No tasks yet. Your hall ticket and instructions will appear after
              allocation.
            </div>
          )}
        </section>
        <section>
          <div className="panel-heading">
            <h2>Recent Activity</h2>
          </div>
          <div className="dashboard-panel activity-list">
            {rows.slice(0, 5).map((r) => (
              <div key={r.id}>
                <span className="activity-icon">
                  <Icon name={finished(r) ? "check" : "file"} size={18} />
                </span>
                <p>
                  {finished(r) ? "Submitted" : "Registered for"}{" "}
                  <strong>{r.exam_name}</strong>
                </p>
                <time>{dateText(r.submitted_at || r.created_at)}</time>
              </div>
            ))}
            {!rows.length && (
              <p className="muted">No examination activity yet.</p>
            )}
          </div>
        </section>
      </div>
      <aside className="candidate-rail">
        <section className="dashboard-panel profile-card">
          <div className="panel-heading">
            <h3>Profile</h3>
            <button className="text-button" onClick={() => onView("Profile")}>
              Edit ↗
            </button>
          </div>
          <Avatar gender={gender} />
          <h3>{profile?.name || user.name}</h3>
          <p>Candidate</p>
          <small>{user.email}</small>
          <div className="profile-verification">
            <span>
              <Icon name="file" size={17} />
              Account
            </span>
            <span>
              <Icon name="check" size={16} />
              {user.emailVerified ? "Email verified" : "Email pending"}
            </span>
          </div>
          {!gender && (
            <button
              className="text-button avatar-choice"
              onClick={() => onView("Profile")}
            >
              Choose your profile illustration
            </button>
          )}
        </section>
        <Calendar rows={rows} />
        <section>
          <div className="panel-heading">
            <h3>Today’s Schedule</h3>
          </div>
          {today.length ? (
            today.map((r) => (
              <button
                className="schedule-card"
                key={r.id}
                onClick={() => onView("My registrations")}
              >
                <Icon name="clock" />
                <strong>
                  {time(r.starts_at)}
                  <small>{time(r.ends_at)}</small>
                </strong>
                <span>
                  {r.exam_name}
                  <small>{r.computer_label || r.center_name}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="dashboard-panel quiet-empty">
              No examinations scheduled for today.
            </div>
          )}
        </section>
        <section>
          <div className="panel-heading">
            <h3>Reminders</h3>
          </div>
          <div className="reminder-card">
            <Icon name="bell" />
            <div>
              <h4>Bring valid ID</h4>
              <p>
                Take your hall ticket and photo ID to your allocated examination
                center.
              </p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

export function CandidateRecords({ rows, mode }) {
  const filtered = rows.filter(
    (r) =>
      !cancelled(r) && (mode === "Hall tickets" ? r.hall_number : finished(r)),
  );
  return (
    <div className="candidate-record-grid">
      {filtered.map((r) => (
        <article className="dashboard-panel" key={r.id}>
          <span className="icon-disc">
            <Icon name={mode === "Hall tickets" ? "ticket" : "chart"} />
          </span>
          <h3>{r.exam_name}</h3>
          <p>{r.hall_number}</p>
          <p className="muted">
            {r.center_name} · {day(r.starts_at)}
          </p>
          {mode === "Hall tickets" ? (
            <a className="button" href={`/api/hall-ticket/${r.allocation_id}`}>
              Download hall ticket <Icon name="arrow" size={17} />
            </a>
          ) : (
            <p className="result-score">
              {r.result_status === "Published"
                ? `Published score: ${r.score}`
                : "Results await publication."}
            </p>
          )}
        </article>
      ))}
      {!filtered.length && (
        <div className="dashboard-panel empty">
          {mode === "Hall tickets"
            ? "Hall tickets appear after your slot is allocated."
            : "Submitted examination results will appear here after publication."}
        </div>
      )}
    </div>
  );
}
