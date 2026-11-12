import { workspaceResources } from "./workspace-resources.js";
// Lookup lists and independent page data start together. The cache is owned by
// one mounted workspace and cleared after mutations and on sign-out.
export async function loadWorkspaceData({
  role,
  view,
  page,
  search,
  selected,
  references,
  api,
}) {
  const c = { exams: [], centers: [], slots: [], pcs: [] };
  const needed = workspaceResources(role, view);
  const cached = async (path) => {
    const hit = references.get(path);
    if (hit && hit.expires > Date.now()) return hit.data;
    const data = await api(path);
    references.set(path, { data, expires: Date.now() + 15000 });
    return data;
  };
  const catalogs = Promise.all([
    needed.exams
      ? cached(
          role === "candidate"
            ? "/examinations?limit=100"
            : "/manage/examinations?limit=100",
        ).then((v) => (c.exams = v))
      : null,
    needed.centers
      ? cached("/manage/centers").then((v) => (c.centers = v))
      : null,
    needed.slots ? api("/manage/slots").then((v) => (c.slots = v)) : null,
    needed.pcs ? api("/manage/computers").then((v) => (c.pcs = v)) : null,
  ]);

  const primary = (async () => {
    let stats, profile;
    const q = `?page=${page}&limit=25&search=${encodeURIComponent(search)}`;
    let data = [];
    if (view === "Overview") {
      if (role === "admin") {
        const s = await api("/manage/overview");
        stats = s;
      } else {
        const dashboard = await api("/dashboard");
        data = dashboard.registrations;
        profile = dashboard.profile;
      }
    } else if (view === "Examinations")
      data =
        role === "candidate"
          ? (await catalogs, c.exams)
          : await api("/manage/examinations" + q);
    else if (view === "Centers") {
      await catalogs;
      data = c.centers;
    } else if (view === "Computers") {
      await catalogs;
      data = c.pcs.filter((p) => !selected || p.center_id === selected);
    } else if (view === "Slots") {
      await catalogs;
      data = c.slots;
    } else if (view === "Registrations")
      data = await api("/manage/registrations" + q);
    else if (view === "Users") data = await api("/manage/users" + q);
    else if (view === "Questions")
      data = selected ? await api("/manage/questions?examId=" + selected) : [];
    else if (view === "Admission")
      data = await api("/invigilator/candidates" + q);
    else if (view === "Results")
      data = await api(
        role === "candidate" ? "/registrations/mine" : "/manage/attempts" + q,
      );
    else if (view === "Notifications")
      data = await api(
        role === "admin" ? "/manage/notifications" : "/notifications",
      );
    else if (view === "Audit") data = await api("/manage/audit" + q);
    else if (["My registrations", "Hall tickets"].includes(view))
      data = await api("/registrations/mine");
    else if (view === "Profile") {
      const p = await api("/profile");
      profile = p;
    }

    return { rows: data, stats, profile };
  })();
  const [, result] = await Promise.all([catalogs, primary]);
  return { catalog: c, ...result };
}
