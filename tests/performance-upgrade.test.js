import test from "node:test";
import assert from "node:assert/strict";
import { workspaceResources } from "../frontend/react/src/workspace-resources.js";
test("dashboard/results/reference loading requests only required role-scoped catalogs", () => {
  assert.deepEqual(workspaceResources("admin", "Overview"), {
    exams: false,
    centers: false,
    slots: false,
    pcs: false,
  });
  assert.deepEqual(workspaceResources("candidate", "Overview"), {
    exams: false,
    centers: false,
    slots: false,
    pcs: false,
  });
  assert.equal(workspaceResources("admin", "Users").pcs, false);
  assert.equal(workspaceResources("invigilator", "Admission").pcs, true);
  assert.equal(workspaceResources("candidate", "Results").exams, false);
});
