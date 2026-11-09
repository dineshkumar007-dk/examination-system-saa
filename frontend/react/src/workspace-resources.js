export function workspaceResources(role, view) {
  return {
    exams:
      role === "candidate"
        ? view === "Examinations"
        : ["Slots", "Registrations", "Announcements", "Results"].includes(view),
    centers:
      ["admin", "invigilator"].includes(role) &&
      [
        "Centers",
        "Computers",
        "Slots",
        "Users",
        "Admission",
        "Workstations",
      ].includes(view),
    slots:
      ["admin", "invigilator"].includes(role) &&
      ["Slots", "Registrations", "Admission", "Workstations"].includes(view),
    pcs:
      ["admin", "invigilator"].includes(role) &&
      ["Computers", "Admission", "Workstations"].includes(view),
  };
}
