import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

test("React dashboard uses selected illustrations and keeps unpublished scores private", async () => {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  try {
    const { Avatar } = await server.ssrLoadModule("/src/illustrations.jsx");
    const { CandidateDashboard, CandidateRecords } = await server.ssrLoadModule(
      "/src/candidate-dashboard.jsx",
    );
    for (const gender of ["male", "female"]) {
      const avatar = renderToStaticMarkup(
        React.createElement(Avatar, { gender }),
      );
      assert.match(
        avatar,
        new RegExp(
          `${gender === "male" ? "Male" : "Female"} profile illustration`,
        ),
      );
    }
    assert.match(
      renderToStaticMarkup(React.createElement(Avatar, {})),
      /aria-label="Profile illustration"/,
    );
    const rows = [
      {
        id: "r1",
        exam_name: "Private paper",
        attempt_status: "submitted",
        result_status: "Draft",
        score: 9876,
        hall_number: "HT-test",
        allocation_id: "a1",
      },
    ];
    const results = renderToStaticMarkup(
      React.createElement(CandidateRecords, { rows, mode: "Results" }),
    );
    assert.match(results, /Results await publication/);
    assert.doesNotMatch(results, /9876/);
    const empty = renderToStaticMarkup(
      React.createElement(CandidateDashboard, {
        rows: [],
        user: {
          name: "Existing Candidate",
          email: "candidate@example.com",
          emailVerified: true,
        },
        onView: () => {},
        navigate: () => {},
      }),
    );
    assert.match(empty, /Your examinations will appear here/);
    assert.match(empty, /Choose your profile illustration/);
    assert.doesNotMatch(empty, /Software Architecture|Rishitha/);
  } finally {
    await server.close();
  }
});
