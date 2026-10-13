import React, { useEffect, useState } from "react";
import { api, dateText, localDate } from "./api.js";
import { Avatar, Icon } from "./illustrations.jsx";
import {
  CandidateDashboard,
  CandidateRecords,
} from "./candidate-dashboard.jsx";
import {
  Form,
  field,
  Modal,
  Notice,
  Status,
  Table,
  useConfirm,
  choices,
  yesNo,
} from "./components.jsx";
const menus = {
  admin: [
    "Overview",
    "Examinations",
    "Centers",
    "Computers",
    "Slots",
    "Registrations",
    "Users",
    "Questions",
    "Admission",
    "Workstations",
    "Results",
    "Notifications",
    "Announcements",
    "Audit",
  ],
  candidate: [
    "Overview",
    "Examinations",
    "My registrations",
    "Hall tickets",
    "Results",
    "Profile",
    "Notifications",
  ],
  invigilator: ["Admission", "Workstations"],
  examiner: ["Questions", "Examinations"],
};
const transitions = {
  draft: ["draft", "open"],
  open: ["open", "closed"],
  closed: ["closed", "active"],
  active: ["active", "completed"],
  completed: ["completed"],
};
const descriptions = {
  Overview: "A clear view of the work ahead.",
  Examinations:
    "Prepare examination details and control the registration lifecycle.",
  Centers: "Manage authorized centers and their seating capacity.",
  Computers: "Keep your center workstation inventory up to date.",
  Slots: "Schedule examination sessions without overlapping a center.",
  Registrations: "Allocate eligible registrations to closed examination slots.",
  Users: "Create staff accounts and manage access.",
  Questions:
    "Build the paper and its answer key before examination activation.",
  Admission:
    "Verify each candidate’s identity and assign the correct computer.",
  Workstations: "Authorize this browser for the physical computer and slot.",
  Results: "Evaluate submitted attempts and publish results when ready.",
  Notifications: "Delivery records for your examination messages.",
  Announcements: "Send an announcement to registered candidates.",
  Audit: "A record of administrative actions.",
};
const opts = (rows, label = "name") =>
  rows.map((r) => ({ value: r.id, label: r[label] }));
const column = (k) => ({
  key: k,
  label: k.replaceAll("_", " "),
  render:
    k.includes("_at") ||
    ["starts_at", "ends_at", "registration_start", "registration_end"].includes(
      k,
    )
      ? dateText
      : ["status", "attendance", "role", "result_status"].includes(k)
        ? (v) => <Status value={v} />
        : k === "active"
          ? (v) => <Status value={v ? "Active" : "Inactive"} />
          : undefined,
});
export function Workspace({ user, navigate }) {
  const [view, setView] = useState(menus[user.role][0]),
    [rows, setRows] = useState([]),
    [catalog, setCatalog] = useState({
      exams: [],
      centers: [],
      slots: [],
      pcs: [],
    }),
    [stats, setStats] = useState({}),
    [profile, setProfile] = useState(null),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState(null),
    [modal, setModal] = useState(null),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState("");
  const [ask, confirmation] = useConfirm();
  const refresh = () => setRevision((r) => r + 1);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const c = { exams: [], centers: [], slots: [], pcs: [] };
      if (user.role !== "invigilator")
        c.exams = await api(
          user.role === "candidate"
            ? "/examinations?limit=100"
            : "/manage/examinations?limit=100",
        );
      if (["admin", "invigilator"].includes(user.role)) {
        [c.centers, c.slots] = await Promise.all([
          api("/manage/centers"),
          api("/manage/slots"),
        ]);
        c.pcs = (
          await Promise.all(
            c.centers.map((center) =>
              api("/manage/computers?centerId=" + center.id),
            ),
          )
        ).flat();
      }
      const q = `?page=${page}&limit=25&search=${encodeURIComponent(search)}`;
      let data = [];
      if (view === "Overview") {
        if (user.role === "admin") {
          const s = await api("/manage/overview");
          if (alive) setStats(s);
        } else {
          data = await api("/registrations/mine");
          const p = await api("/profile");
          if (alive) setProfile(p);
        }
      } else if (view === "Examinations")
        data =
          user.role === "candidate"
            ? c.exams
            : await api("/manage/examinations" + q);
      else if (view === "Centers") data = c.centers;
      else if (view === "Computers")
        data = c.pcs.filter((p) => !selected || p.center_id === selected);
      else if (view === "Slots") data = c.slots;
      else if (view === "Registrations")
        data = await api("/manage/registrations" + q);
      else if (view === "Users") data = await api("/manage/users" + q);
      else if (view === "Questions")
        data = selected
          ? await api("/manage/questions?examId=" + selected)
          : [];
      else if (view === "Admission")
        data = await api("/invigilator/candidates" + q);
      else if (view === "Results")
        data = await api(
          user.role === "candidate"
            ? "/registrations/mine"
            : "/manage/attempts" + q,
        );
      else if (view === "Notifications")
        data = await api(
          user.role === "admin" ? "/manage/notifications" : "/notifications",
        );
      else if (view === "Audit") data = await api("/manage/audit" + q);
      else if (["My registrations", "Hall tickets"].includes(view))
        data = await api("/registrations/mine");
      else if (view === "Profile") {
        const p = await api("/profile");
        if (alive) setProfile(p);
      }
      if (alive) {
        setCatalog(c);
        setRows(data);
      }
    })()
      .catch((e) => {
        if (alive) {
          setNotice({ text: e.message, kind: "error" });
          if (e.status === 401) navigate("/login");
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [view, revision, selected, page, search]);
  const action = async (fn) => {
    try {
      const r = await fn();
      setNotice({
        text: r?.message || "Changes saved.",
        kind:
          r?.emailStatus === "queued" || r?.kind === "warning" ? "warning" : "",
      });
      refresh();
    } catch (e) {
      setNotice({ text: e.message, kind: "error" });
      if (e.status === 401) navigate("/login");
    }
  };
  const open = (title, fields, initial, onSave) =>
    setModal({ title, fields, initial, onSave });
  const deleteRecord = async (type, r) => {
    if (
      await ask(
        `Delete ${r.name || r.exam_name || r.label || "this record"}? Access will be revoked. Examination history is retained when required. Live attempts can prevent deletion.`,
      )
    )
      await action(() => api("/manage/" + type + "/" + r.id, "DELETE"));
  };
  const editExam = (r) =>
    open(
      r ? "Edit examination" : "Create examination",
      [
        field("name", "Examination name"),
        field("description", "Description", "textarea"),
        field("instructions", "Instructions", "textarea"),
        field("durationMinutes", "Duration (minutes)", "number"),
        field("registrationStart", "Registration opens", "datetime-local"),
        field("registrationEnd", "Registration closes", "datetime-local"),
        field("fee", "Simulated fee (₹)", "number"),
        field(
          "status",
          "Status",
          "select",
          choices(r ? transitions[r.status] : ["draft", "open"]),
        ),
      ],
      r
        ? {
            ...r,
            durationMinutes: r.duration_minutes,
            registrationStart: localDate(r.registration_start),
            registrationEnd: localDate(r.registration_end),
          }
        : { durationMinutes: 180, fee: 0, status: "draft" },
      (d) =>
        api(
          "/manage/examinations" + (r ? "/" + r.id : ""),
          r ? "PUT" : "POST",
          {
            ...d,
            durationMinutes: Number(d.durationMinutes),
            fee: Number(d.fee),
            registrationStart: new Date(d.registrationStart).toISOString(),
            registrationEnd: new Date(d.registrationEnd).toISOString(),
          },
        ),
    );
  const editCenter = (r) =>
    open(
      r ? "Edit center" : "Create center",
      [
        field("name", "Center name"),
        field("address", "Address", "textarea"),
        field("city", "City"),
        field("state", "State"),
        field("capacity", "Candidate capacity", "number"),
        field("active", "Active", "select", yesNo),
      ],
      r || { active: true },
      (d) =>
        api("/manage/centers" + (r ? "/" + r.id : ""), r ? "PUT" : "POST", {
          ...d,
          capacity: Number(d.capacity),
          active: String(d.active) === "true",
        }),
    );
  const createSlot = () =>
    open(
      "Create examination slot",
      [
        field(
          "examId",
          "Examination",
          "select",
          catalog.exams.map((e) => ({
            value: e.id,
            label: `${e.name} · ${e.duration_minutes} min`,
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
              label: `${c.name} · ${c.capacity} seats`,
            })),
        ),
        field("startsAt", "Starts (local time)", "datetime-local"),
        field("endsAt", "Ends (local time)", "datetime-local"),
        field("capacity", "Candidate capacity", "number"),
      ],
      {},
      (d) =>
        api("/manage/slots", "POST", {
          ...d,
          capacity: Number(d.capacity),
          startsAt: new Date(d.startsAt).toISOString(),
          endsAt: new Date(d.endsAt).toISOString(),
        }),
    );
  const createStaff = () =>
    open(
      "Create staff account",
      [
        field("name", "Full name"),
        field("email", "Email", "email"),
        field("role", "Role", "select", choices(["invigilator", "examiner"])),
        field(
          "centerId",
          "Assigned center",
          "select",
          [{ value: "", label: "No center" }, ...opts(catalog.centers)],
          { required: false, noBlank: true },
        ),
        field(
          "password",
          "Login password — at least 12 characters",
          "password",
        ),
        field("confirmPassword", "Confirm password", "password"),
      ],
      { role: "invigilator" },
      (d) =>
        api("/manage/staff", "POST", { ...d, centerId: d.centerId || null }),
    );
  const editAccess = (r) =>
    open(
      "Access · " + r.name,
      [
        field(
          "role",
          "Role",
          "select",
          choices(["candidate", "invigilator", "examiner"]),
        ),
        field("status", "Status", "select", choices(["active", "disabled"])),
        field(
          "centerId",
          "Assigned center",
          "select",
          [{ value: "", label: "No center" }, ...opts(catalog.centers)],
          { required: false, noBlank: true },
        ),
      ],
      { ...r, centerId: r.center_id || "" },
      (d) =>
        api("/manage/users/" + r.id, "PATCH", {
          ...d,
          centerId: d.centerId || null,
        }),
    );
  const allocate = (r) =>
    open(
      "Allocate · " + r.name,
      [
        field(
          "slotId",
          "Matching examination slot",
          "select",
          catalog.slots
            .filter((s) => s.exam_id === r.exam_id)
            .map((s) => ({
              value: s.id,
              label: `${s.center_name} · ${dateText(s.starts_at)} · ${s.allocated}/${s.capacity}`,
            })),
        ),
      ],
      {},
      (d) => api("/manage/allocate", "POST", { registrationId: r.id, ...d }),
    );
  const verify = (r, attendanceOnly = false) =>
    open(
      (attendanceOnly ? "Mark attendance · " : "Verify for exam · ") + r.name,
      [
        field("attendance", "Attendance", "select", [
          {
            value: "Verified",
            label: "Verified — identity checked and computer assigned",
          },
          { value: "Present", label: "Present — arrival only" },
          { value: "Absent", label: "Absent" },
        ]),
        field(
          "computerId",
          "Assigned computer",
          "select",
          [
            { value: "", label: "No computer" },
            ...opts(
              catalog.pcs.filter(
                (p) => p.center_id === r.center_id && p.active,
              ),
              "label",
            ),
          ],
          { required: false, noBlank: true },
        ),
        field(
          "identityChecked",
          "I inspected physical ID and matched candidate, center and slot",
          "select",
          yesNo,
        ),
      ],
      {
        attendance: attendanceOnly
          ? ["Present", "Verified", "Absent"].includes(r.attendance)
            ? r.attendance
            : "Present"
          : "Verified",
        computerId: r.computer_id || "",
        identityChecked: !!r.verified_at,
      },
      async (d) => {
        const revoke =
          r.attendance === "Verified" && d.attendance !== "Verified";
        if (
          revoke &&
          !(await ask(
            "Remove verification and clear the assigned computer? This blocks examination access.",
          ))
        )
          throw new Error("Verification change cancelled.");
        return api("/invigilator/verify", "POST", {
          allocationId: r.id,
          computerId: d.computerId || null,
          attendance: d.attendance,
          identityChecked: String(d.identityChecked) === "true",
          revokeVerification: revoke,
        });
      },
    );
  const grant = () =>
    open(
      "Grant access to this browser",
      [
        field(
          "slotId",
          "Examination slot",
          "select",
          catalog.slots.map((s) => ({
            value: s.id,
            label: `${s.exam_name} · ${dateText(s.starts_at)}`,
          })),
        ),
        field("computerId", "Actual workstation label", "select", (v) =>
          opts(
            catalog.pcs.filter(
              (p) =>
                p.active &&
                p.center_id ===
                  catalog.slots.find((s) => s.id === v.slotId)?.center_id,
            ),
            "label",
          ),
        ),
      ],
      {},
      (d) => api("/invigilator/workstation", "POST", d),
    );
  const editQuestion = (r) => {
    if (!selected) return;
    open(
      r ? "Edit question" : "Add question",
      [
        field(
          "type",
          "Question type",
          "select",
          choices(["MCQ", "MSQ", "NAT"]),
        ),
        field("prompt", "Question text", "textarea", null, { wide: true }),
        field(
          "options",
          "Options, one per line: A|Option text",
          "textarea",
          null,
          { required: false, wide: true },
        ),
        field("key", "Answer key", null, null, {
          help: "MCQ: A · MSQ: A,B · NAT: a number",
        }),
        field("tolerance", "Numeric tolerance", "number"),
        field("marks", "Marks", "number"),
        field("negativeMarks", "Negative marks", "number"),
        field("position", "Question number", "number"),
      ],
      r
        ? {
            ...r,
            options: r.options.map((o) => o.id + "|" + o.text).join("\n"),
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
      (d) =>
        api("/manage/questions" + (r ? "/" + r.id : ""), r ? "PUT" : "POST", {
          examId: selected,
          type: d.type,
          prompt: d.prompt,
          options:
            d.type === "NAT"
              ? []
              : d.options
                  .split("\n")
                  .filter(Boolean)
                  .map((line) => {
                    const i = line.indexOf("|");
                    return {
                      id: line.slice(0, i).trim(),
                      text: line.slice(i + 1).trim(),
                    };
                  }),
          correctAnswer:
            d.type === "NAT"
              ? Number(d.key)
              : d.key.split(",").map((s) => s.trim()),
          tolerance: Number(d.tolerance),
          marks: Number(d.marks),
          negativeMarks: Number(d.negativeMarks),
          position: Number(d.position),
        }),
    );
  };
  const reissue = async (r) => {
    if (
      await ask(
        "Email a new examination password? The previous password and setup link will stop working.",
      )
    )
      await action(() =>
        api("/manage/activation/" + r.allocation_id, "POST", {}),
      );
  };
  const columns = {
    Examinations: [
      "name",
      "status",
      "duration_minutes",
      "fee",
      "registration_start",
      "registration_end",
    ],
    Centers: ["name", "city", "state", "capacity", "active"],
    Computers: ["label", "active"],
    Slots: [
      "exam_name",
      "center_name",
      "starts_at",
      "ends_at",
      "capacity",
      "allocated",
    ],
    Registrations: [
      "name",
      "exam_name",
      "registration_number",
      "status",
      "hall_number",
    ],
    Users: ["name", "email", "role", "status"],
    Questions: ["position", "type", "prompt", "marks", "negative_marks"],
    Admission: [
      "name",
      "registration_number",
      "hall_number",
      "starts_at",
      "attendance",
      "computer_label",
    ],
    Results: [
      "name",
      "exam_name",
      "registration_number",
      "status",
      "result_status",
      "score",
    ],
    Notifications: [
      ...(user.role === "admin" ? ["email"] : []),
      "event",
      "status",
      "sent_at",
      "error_code",
    ],
    Audit: ["actor", "action", "entity_id", "created_at"],
  };
  const actions = (r) => {
    if (view === "Examinations" && user.role === "admin")
      return (
        <>
          <button
            className="small-button secondary"
            onClick={() => editExam(r)}
          >
            Edit
          </button>
          <button
            className="small-button danger"
            onClick={() => deleteRecord("examinations", r)}
          >
            Delete
          </button>
        </>
      );
    if (view === "Examinations" && user.role === "candidate")
      return r.status === "open" ? (
        <button
          className="small-button"
          onClick={() =>
            action(() => api("/registrations", "POST", { examId: r.id }))
          }
        >
          Register
        </button>
      ) : null;
    if (view === "Centers")
      return (
        <>
          <button
            className="small-button secondary"
            onClick={() => editCenter(r)}
          >
            Edit
          </button>
          <button
            className="small-button danger"
            onClick={() => deleteRecord("centers", r)}
          >
            Delete
          </button>
        </>
      );
    if (view === "Slots")
      return (
        <button
          className="small-button danger"
          onClick={() => deleteRecord("slots", r)}
        >
          Delete
        </button>
      );
    if (view === "Users" && r.role !== "admin")
      return (
        <>
          <button
            className="small-button secondary"
            onClick={() => editAccess(r)}
          >
            Edit access
          </button>
          <button
            className="small-button danger"
            onClick={() => deleteRecord("users", r)}
          >
            Delete
          </button>
        </>
      );
    if (view === "Registrations")
      return r.exam_deleted_at || r.slot_deleted_at ? (
        <small>Removed from schedule</small>
      ) : r.allocation_id ? (
        <button className="small-button secondary" onClick={() => reissue(r)}>
          Reissue credentials
        </button>
      ) : r.status === "completed" ? (
        <button className="small-button" onClick={() => allocate(r)}>
          Allocate slot
        </button>
      ) : null;
    if (
      view === "Admission" &&
      !["Exam Started", "Exam Submitted"].includes(r.attendance)
    )
      return (
        <>
          <button className="small-button" onClick={() => verify(r)}>
            Verify for exam
          </button>
          <button
            className="small-button secondary"
            onClick={() => verify(r, true)}
          >
            Mark attendance
          </button>
        </>
      );
    if (view === "Computers")
      return (
        <button
          className="small-button secondary"
          onClick={() =>
            action(() =>
              api("/manage/computers/" + r.id, "PATCH", { active: !r.active }),
            )
          }
        >
          {r.active ? "Deactivate" : "Activate"}
        </button>
      );
    if (view === "Questions")
      return (
        <>
          <button
            className="small-button secondary"
            onClick={() => editQuestion(r)}
          >
            Edit
          </button>
          <button
            className="small-button danger"
            onClick={() => deleteRecord("questions", r)}
          >
            Delete
          </button>
        </>
      );
    if (
      view === "Notifications" &&
      user.role === "admin" &&
      r.status === "failed"
    )
      return (
        <button
          className="small-button secondary"
          onClick={() =>
            action(() =>
              api("/manage/notifications/" + r.id + "/retry", "POST", {}),
            )
          }
        >
          Retry
        </button>
      );
    return null;
  };
  const add = {
    Examinations:
      user.role === "admin" ? ["Create examination", () => editExam()] : null,
    Centers: ["Add center", () => editCenter()],
    Slots: ["Create slot", createSlot],
    Users: ["Create staff account", createStaff],
    Questions: selected ? ["Add question", () => editQuestion()] : null,
    Computers: selected
      ? [
          "Add computer",
          () =>
            open("Add computer", [field("label", "Computer label")], {}, (d) =>
              api("/manage/computers", "POST", { ...d, centerId: selected }),
            ),
        ]
      : null,
  }[view];
  return (
    <div
      className={`workspace role-${user.role} view-${view === "Overview" ? "overview" : "records"}`}
    >
      <aside className="sidebar">
        <div className="sidebar-title">
          <div className="sidebar-brand">
            <Icon name="cap" size={47} />
            <strong>EXAMPRO</strong>
            <p>Examination Portal</p>
          </div>
          <span className="eyebrow">{user.role} workspace</span>
          <strong>{user.name}</strong>
        </div>
        <nav>
          {menus[user.role].map((v) => (
            <button
              key={v}
              className={view === v ? "selected" : ""}
              onClick={() => {
                setView(v);
                setSearch("");
                setPage(1);
                setSelected("");
                setNotice(null);
              }}
            >
              <Icon
                name={
                  {
                    Overview: "home",
                    Examinations: "file",
                    "My registrations": "file",
                    "Hall tickets": "ticket",
                    Results: "chart",
                    Notifications: "bell",
                    Profile: "settings",
                    Users: "people",
                    Computers: "monitor",
                    Slots: "calendar",
                    Workstations: "monitor",
                    Centers: "pin",
                  }[v] || "file"
                }
              />
              {v === "Overview"
                ? "Dashboard"
                : v === "Profile"
                  ? "Settings"
                  : v}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Avatar gender={profile?.gender ?? user.gender} scene />
          <h3>Ready for exam day?</h3>
          <p>
            Keep your hall ticket and photo ID ready. Your center staff can help
            with admission.
          </p>
          <button
            className="secondary"
            onClick={() =>
              user.role === "candidate"
                ? setView("My registrations")
                : setView(menus[user.role][0])
            }
          >
            Your examination details <Icon name="arrow" size={16} />
          </button>
        </div>
      </aside>
      <main className="workspace-main">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              EXAMPRO /{" "}
              {user.role === "candidate" ? "Candidate services" : "Operations"}
            </p>
            <h1>{view}</h1>
            <p className="muted">
              {user.role === "candidate" && view === "Results"
                ? "Your submitted examinations and published results."
                : descriptions[view] ||
                  "Your examination details, kept together."}
            </p>
          </div>
          {add && <button onClick={add[1]}>{add[0]} +</button>}
        </div>
        <Notice message={notice} />
        {loading ? (
          <p className="loading" role="status">
            Loading records…
          </p>
        ) : (
          <>
            {view === "Overview" ? (
              user.role === "admin" ? (
                <>
                  <div className="metrics">
                    {Object.entries(stats).map(([k, v]) => (
                      <div key={k}>
                        <span>{k.replaceAll("_", " ")}</span>
                        <strong>{v}</strong>
                      </div>
                    ))}
                  </div>
                  <section className="panel operational-note">
                    <h2>Examination lifecycle</h2>
                    <ol>
                      <li>Prepare the examination and question paper.</li>
                      <li>
                        Open registration, then close it before allocating
                        slots.
                      </li>
                      <li>Verify candidates and authorize hall browsers.</li>
                      <li>
                        Activate the exam, evaluate attempts, then publish
                        results.
                      </li>
                    </ol>
                  </section>
                </>
              ) : (
                <>
                  <CandidateDashboard
                    user={user}
                    profile={profile}
                    rows={rows}
                    onView={setView}
                    navigate={navigate}
                  />
                  {profile?.selected_exam_id &&
                    !rows.some(
                      (r) => r.exam_id === profile.selected_exam_id,
                    ) && (
                      <button
                        className="secondary"
                        onClick={() =>
                          action(() =>
                            api("/registrations", "POST", {
                              examId: profile.selected_exam_id,
                            }),
                          )
                        }
                      >
                        Complete selected exam registration
                      </button>
                    )}
                </>
              )
            ) : null}
            {user.role === "candidate" &&
              ["Hall tickets", "Results"].includes(view) && (
                <CandidateRecords rows={rows} mode={view} />
              )}
            {columns[view] &&
              !(user.role === "candidate" && view === "Results") && (
                <section className="panel records">
                  <div className="table-toolbar">
                    <label>
                      Search records
                      <input
                        type="search"
                        defaultValue={search}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setSearch(e.currentTarget.value);
                            setPage(1);
                          }
                        }}
                        placeholder="Type and press Enter"
                      />
                    </label>
                    {view === "Questions" && (
                      <label>
                        Examination
                        <select
                          value={selected}
                          onChange={(e) => setSelected(e.target.value)}
                        >
                          <option value="">Choose examination</option>
                          {catalog.exams.map((e) => (
                            <option value={e.id} key={e.id}>
                              {e.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    {view === "Computers" && (
                      <label>
                        Center
                        <select
                          value={selected}
                          onChange={(e) => setSelected(e.target.value)}
                        >
                          <option value="">All centers</option>
                          {catalog.centers.map((c) => (
                            <option value={c.id} key={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {view === "Registrations" && (
                    <p className="table-hint">
                      Close registration before allocation. Credentials are
                      emailed immediately after allocation.
                    </p>
                  )}
                  <Table
                    rows={rows}
                    columns={columns[view].map(column)}
                    actions={actions}
                  />
                  {[
                    "Examinations",
                    "Registrations",
                    "Users",
                    "Admission",
                    "Results",
                    "Audit",
                  ].includes(view) && (
                    <div className="pagination">
                      <span>Page {page}</span>
                      <button
                        className="small-button secondary"
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                      >
                        Previous
                      </button>
                      <button
                        className="small-button secondary"
                        disabled={rows.length < 25}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </section>
              )}
            {view === "Workstations" && (
              <section className="panel workstation-panel">
                <div className="device-mark" aria-hidden="true">
                  ▣
                </div>
                <h2>Authorize the computer in front of you.</h2>
                <p>
                  Grant this browser access for the correct workstation label
                  and examination slot. Sign out before the assigned candidate
                  signs in using this same browser and website domain.
                </p>
                <p className="muted">
                  A grant on localhost or another browser will not authorize
                  this browser. Every student computer needs its own grant.
                </p>
                <button onClick={grant}>Grant access to this device →</button>
              </section>
            )}
            {view === "My registrations" && (
              <div className="registration-grid">
                {rows.length ? (
                  rows.map((r) => (
                    <article className="panel registration" key={r.id}>
                      <div className="section-heading">
                        <h2>{r.exam_name}</h2>
                        <Status value={r.status} />
                      </div>
                      <dl>
                        <dt>Registration ID</dt>
                        <dd>{r.registration_number}</dd>
                        <dt>Application ID</dt>
                        <dd>{r.application_number}</dd>
                        {r.allocation_id && (
                          <>
                            <dt>Center</dt>
                            <dd>
                              {r.center_name}
                              <small>{r.center_address}</small>
                            </dd>
                            <dt>Examination slot</dt>
                            <dd>
                              {dateText(r.starts_at)} — {dateText(r.ends_at)}
                            </dd>
                            <dt>Hall ticket</dt>
                            <dd>{r.hall_number}</dd>
                            <dt>Admission</dt>
                            <dd>
                              {r.attendance} ·{" "}
                              {r.computer_label || "Computer not assigned"}
                            </dd>
                            <dt>Examination password</dt>
                            <dd>
                              {r.exam_password_set
                                ? "Set — use your credentials email"
                                : "Not set yet"}
                            </dd>
                          </>
                        )}
                      </dl>
                      {r.exam_deleted_at || r.slot_deleted_at ? (
                        <Notice
                          message={{
                            text: "Removed from schedule. Contact the examination authority.",
                            kind: "warning",
                          }}
                        />
                      ) : (
                        r.allocation_id && (
                          <a
                            className="button secondary"
                            href={"/api/hall-ticket/" + r.allocation_id}
                          >
                            Download hall ticket PDF ↓
                          </a>
                        )
                      )}
                      {r.payment_status && (
                        <div className="payment">
                          <p>
                            Simulated payment: {r.payment_status} · ₹{r.amount}
                          </p>
                          <small>
                            Academic simulation. No money is collected.
                          </small>
                          {r.payment_status !== "Successful" &&
                            r.status !== "cancelled" && (
                              <div className="row-actions">
                                <button
                                  className="small-button"
                                  onClick={() =>
                                    action(() =>
                                      api("/payments/simulate", "POST", {
                                        registrationId: r.id,
                                        outcome: "Successful",
                                      }),
                                    )
                                  }
                                >
                                  Simulate successful payment
                                </button>
                                <button
                                  className="small-button secondary"
                                  onClick={() =>
                                    action(() =>
                                      api("/payments/simulate", "POST", {
                                        registrationId: r.id,
                                        outcome: "Failed",
                                      }),
                                    )
                                  }
                                >
                                  Simulate failed payment
                                </button>
                              </div>
                            )}
                        </div>
                      )}
                      {r.attempt_status === "submitted" && (
                        <Notice
                          message={{
                            text:
                              r.result_status === "Published"
                                ? `Published score: ${r.score}`
                                : "Examination submitted. Results await publication.",
                          }}
                        />
                      )}
                    </article>
                  ))
                ) : (
                  <div className="panel empty">
                    No examination registrations yet.
                  </div>
                )}
              </div>
            )}
            {view === "Profile" && profile && (
              <section className="panel">
                <div className="profile-editor-avatar">
                  <Avatar gender={profile.gender} />
                  <div>
                    <h2>Your profile</h2>
                    <p className="muted">
                      Choose Male or Female below to update your dashboard
                      illustration.
                    </p>
                  </div>
                </div>
                <p>
                  {profile.email} · {profile.phone}
                </p>
                <Form
                  fields={[
                    field("name", "Full name"),
                    field(
                      "gender",
                      "Gender",
                      "select",
                      [
                        { value: "male", label: "Male" },
                        { value: "female", label: "Female" },
                      ],
                      {
                        help: "Select the illustration shown on your dashboard.",
                      },
                    ),
                    field("address", "Address", "textarea"),
                  ]}
                  initial={profile}
                  onSubmit={(d) => action(() => api("/profile", "PATCH", d))}
                />
              </section>
            )}
            {view === "Announcements" && (
              <section className="panel">
                <Form
                  fields={[
                    field(
                      "examId",
                      "Examination",
                      "select",
                      opts(catalog.exams),
                    ),
                    field("message", "Announcement", "textarea", null, {
                      wide: true,
                    }),
                  ]}
                  button="Send announcement"
                  onSubmit={async (d) => {
                    if (
                      await ask(
                        "Email this announcement to registered candidates?",
                      )
                    )
                      await action(() => api("/manage/announce", "POST", d));
                  }}
                />
              </section>
            )}
            {view === "Results" && user.role === "admin" && (
              <section className="panel results-publish">
                <h2>Evaluate submitted attempts</h2>
                <p>
                  Evaluate the selected examination. Scores stay private until
                  publication.
                </p>
                <Form
                  fields={[
                    field(
                      "examId",
                      "Examination",
                      "select",
                      opts(catalog.exams),
                    ),
                  ]}
                  button="Evaluate submitted attempts"
                  onSubmit={(d) =>
                    action(() => api("/manage/evaluate", "POST", d))
                  }
                />
                <hr />
                <h2>Publish examination results</h2>
                <p>
                  Complete the examination first. Publication makes evaluated
                  scores visible to candidates.
                </p>
                <Form
                  fields={[
                    field(
                      "examId",
                      "Examination",
                      "select",
                      opts(catalog.exams),
                    ),
                  ]}
                  button="Publish results"
                  onSubmit={async (d) => {
                    if (
                      await ask(
                        "Publish these scores to candidates? Published results are locked against re-evaluation.",
                      )
                    )
                      await action(() => api("/manage/publish", "POST", d));
                  }}
                />
              </section>
            )}
          </>
        )}
        {modal && (
          <Modal title={modal.title} onClose={() => setModal(null)}>
            <Form
              fields={modal.fields}
              initial={modal.initial}
              onCancel={() => setModal(null)}
              onSubmit={async (d) => {
                const r = await modal.onSave(d);
                setModal(null);
                setNotice({
                  text: r?.message || "Changes saved.",
                  kind:
                    r?.emailStatus === "queued" || r?.kind === "warning"
                      ? "warning"
                      : "",
                });
                refresh();
              }}
            />
          </Modal>
        )}
        {confirmation}
      </main>
    </div>
  );
}
