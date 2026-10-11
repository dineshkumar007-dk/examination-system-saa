// Isolated DOM/API stubs for module initialization regression tests. No provider delivery.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
const nodes = new Map();
let currentRole = "invigilator";
const element = (selector) => {
  if (!nodes.has(selector))
    nodes.set(selector, {
      innerHTML: "",
      textContent: "",
      className: "",
      classList: { toggle() {} },
      setAttribute() {},
    });
  return nodes.get(selector);
};
globalThis.document = {
  body: { dataset: { page: "invigilator" } },
  querySelectorAll: () => [],
};
mock.method(globalThis, "setInterval", () => 1);
mock.method(globalThis, "clearInterval", () => {});
mock.module("../frontend/common.js", {
  namedExports: {
    $: element,
    esc: (value) => String(value ?? ""),
    me: async () => ({ name: "Fixture candidate", role: currentRole }),
    api: async (url) => {
      if (
        currentRole === "invigilator" &&
        url.startsWith("/manage/examinations")
      )
        throw new Error(
          "Invigilators cannot read the administrative exam catalog",
        );
      if (
        url === "/manage/centers" ||
        url === "/manage/slots" ||
        url.startsWith("/invigilator/candidates")
      )
        return [];
      if (url === "/exam/attempt")
        return {
          id: "fixture-attempt",
          candidateName: "Fixture candidate",
          examName: "Fixture examination",
          instructions: "Fixture instructions",
          serverTime: Date.now(),
          deadline: Date.now() + 3600000,
          questions: [
            {
              id: "fixture-question",
              type: "MCQ",
              prompt: "Fixture question text",
              marks: 1,
              negative_marks: 0,
              options: [{ id: "A", text: "First" }],
            },
          ],
          answers: [],
        };
      throw new Error("Unexpected isolated frontend request " + url);
    },
    localDate: () => "",
    message: (text) => {
      element("#live-message").textContent = text;
    },
    bindForm: () => {},
    table: () => "<table>Fixture records</table>",
    button: () => "",
    confirmDialog: async () => false,
    passwordField: () => "",
    setupToggles: () => {},
  },
});
test("mocked invigilator screen initializes without temporal-dead-zone or unauthorized catalog calls", async () => {
  await import("../frontend/workspace.js");
  assert.match(element("#view-content").innerHTML, /Fixture records/);
  assert.equal(element("#view-title").textContent, "Invigilator");
  assert.equal(element("#live-message").textContent, "");
});
test("mocked CBT screen restores an attempt and initializes authoritative timer", async () => {
  nodes.clear();
  currentRole = "candidate";
  document.body.dataset.page = "exam";
  await import("../frontend/exam.js");
  assert.match(element("#question").innerHTML, /Fixture question text/);
  assert.match(element("#timer").textContent, /^\d\d:\d\d:\d\d$/);
  assert.doesNotMatch(element("#content").innerHTML, /exam-login/);
});
