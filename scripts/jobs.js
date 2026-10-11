import { finalizeExpired } from "../backend/src/services/exams.js";
import { processNotifications } from "../backend/src/services/communications.js";
import { closeDatabase } from "../backend/src/config/database.js";
try {
  console.log(
    JSON.stringify({
      finalized: await finalizeExpired(),
      emailsSent: await processNotifications(),
    }),
  );
} finally {
  await closeDatabase();
}
