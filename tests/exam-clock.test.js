import test from "node:test";
import assert from "node:assert/strict";
import { createExamClock } from "../frontend/react/src/exam-clock.js";
test("exam countdown continues offline and ignores changes to the browser wall clock", (t) => {
  let elapsed = 100;
  const clock = createExamClock(100000, 160000, () => elapsed);
  assert.equal(clock.remaining(), 60);
  t.mock.method(Date, "now", () => 99999999999999);
  assert.equal(clock.remaining(), 60);
  elapsed += 45000;
  assert.equal(clock.remaining(), 15);
  elapsed += 20000;
  assert.equal(clock.remaining(), 0);
});
