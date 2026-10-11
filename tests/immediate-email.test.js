import { test, mock } from "node:test";
import assert from "node:assert/strict";
process.env.DATA_ENCRYPTION_KEY = "a".repeat(64);
Object.assign(process.env, {
  SMTP_FROM: "EXAMPRO <sender@example.com>",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "sender",
  SMTP_PASSWORD: "test-password",
});
const state = { item: null, fail: false, delivered: [], selected: [] };
mock.module("nodemailer", {
  defaultExport: {
    createTransport: () => ({
      sendMail: async (message) => {
        if (state.fail) throw new Error("Provider unavailable");
        state.delivered.push(message);
        return { accepted: [message.to] };
      },
    }),
  },
});
mock.module("../backend/src/config/database.js", {
  namedExports: {
    transaction: async (fn) => fn({}),
    query: async (sql, args) => {
      if (sql.startsWith("SELECT n.*")) {
        state.selected.push(args);
        return state.item.status === "pending" ? [{ ...state.item }] : [];
      }
      if (sql.startsWith("SELECT exam_password_hash"))
        return [{ exam_password_hash: "current-hash" }];
      if (sql.startsWith("UPDATE notifications SET status='sending'")) {
        state.item.status = "sending";
        return {};
      }
      if (sql.startsWith("UPDATE notifications SET status='sent'")) {
        state.item.status = "sent";
        state.item.payload_encrypted = null;
        return {};
      }
      if (sql.startsWith("UPDATE notifications SET status=?")) {
        state.item.status = args[0];
        return {};
      }
      if (sql.startsWith("SELECT status"))
        return [{ status: state.item.status }];
      throw new Error("Unexpected isolated query: " + sql);
    },
  },
});
const { seal } = await import("../backend/src/utils/security.js");
const { deliverQueuedNotification } = await import(
  "../backend/src/services/communications.js"
);
function setup(fail = false) {
  state.fail = fail;
  state.delivered = [];
  state.selected = [];
  state.item = {
    id: "notification",
    email: "candidate@example.com",
    event: "Hall ticket and examination credentials",
    status: "pending",
    attempts: 0,
    payload_encrypted: seal({
      text: "Registration ID: EXP-123\nHall ticket number: HT-123\nExamination password: private",
      allocationId: "allocation",
      examPasswordHash: "current-hash",
    }),
  };
}
test("immediate delivery sends only the newly queued credentials to the registered candidate", async () => {
  setup();
  assert.equal(await deliverQueuedNotification("notification"), "sent");
  assert.deepEqual(state.selected, [["notification"]]);
  assert.equal(state.delivered.length, 1);
  assert.equal(state.delivered[0].to, "candidate@example.com");
  assert.match(state.delivered[0].text, /Examination password:/);
  assert.equal(state.item.payload_encrypted, null);
});
test("SMTP failure reports queued and retains encrypted credentials for retry", async () => {
  setup(true);
  assert.equal(await deliverQueuedNotification("notification"), "queued");
  assert.equal(state.item.status, "pending");
  assert.ok(state.item.payload_encrypted);
  assert.equal(state.delivered.length, 0);
});
