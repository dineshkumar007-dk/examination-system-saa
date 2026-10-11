# EXAMPRO verification record

Checked on 11 October 2026 using Node.js 24.11.1.

| Check | Result |
|---|---|
| `npm run lint` | Passed |
| `npm test` | 41 passed, 0 failed |
| `npm run build` | Passed; JavaScript syntax checked and deployment static assets generated |
| npm dependency audit after installing patched Nodemailer and formatter | 0 vulnerabilities reported |
| Local HTTP tests | Passed for public assets, protected APIs, CSRF, security headers, request-size rejection and safe errors |
| In-app browser inspection | Landing/signup at a narrow viewport and login at 1280×900 inspected |
| Missing-service behavior | Public listings show a genuine missing-database configuration error; no fake records |
| `npm run db:check` | Passed with the supplied Aiven connection and CA; TLS active |
| `npm run test:integration` | 1 suite intentionally skipped because `INTEGRATION_TESTS` was not enabled and no disposable MySQL database was configured |
| Real email receipt | Gmail SMTP delivery tested; user confirmed successful email OTP verification |
| SMS OTP | Removed; email verification alone activates candidates |
| Hosted SQL migrations | Migration runner passed; `001_initial.sql` and `002_email_only_verification.sql` recorded; 24 tables verified |
| Real concurrency | Not verified; use the dedicated MySQL integration suite |
| Vercel deployment and redeployment persistence | Not performed; provider accounts/configuration required |

The 41 tests comprise 12 pure validation/security checks, 5 real local HTTP checks and 24 isolated mocked authentication, exam-service and frontend-initialization checks. Mocked delivery and repository tests are not evidence of real provider delivery or database behavior. The optional MySQL suite tests saved data across connection-pool restart; production redeployment persistence still requires a deployed test.

The source contains no production mock-delivery switch, fixed OTP, hardcoded user, in-memory production database, or public administrative signup. Payment functionality is explicitly a simulation. QR scanning, hardware attestation, automated ID verification and real payment collection are not implemented.

Use the README release checklist after configuring the managed services. Before a high-stakes examination, verify representative concurrency, scheduler operation, physical workstation controls, backups and restore, and complete an independent security review.

Separate invigilator login added and checked in the browser. Role-restricted login regression passed; device authorization continues to require invigilator privileges and assigned-center scope. Physical-location enforcement requires supervised kiosks and a network or device policy.

Examination deletion regression passed for unused draft/open/closed exams, dependent record cleanup, audit logging and rejection of registered/active/completed exams. No existing examination was deleted during this change.

Allocation diagnostics now identify open registration, mismatched slots, inactive centers, incomplete registration, unverified email and past slots separately. Regression test confirms invalid allocation does not create a hall ticket.

Generated examination credentials emails include Registration ID, hall-ticket number and a random examination password. Tests verify bcrypt matching, password replacement and started-attempt rejection. Sending credentials for the existing registration awaits explicit recipient approval after an automatic approval rejection.

Staff account creation now requires a strong matching password and confirmation. New administrator-provisioned accounts can sign in immediately; passwords remain bcrypt hashed and are not included in staff invitation emails.

User deletion added with access revocation and retained exam records. Migration 003 applied. Regression checks passed for candidate/staff deletion and self/admin/missing/already-deleted protections. No existing user was deleted during this change.

Deletion now permanently removes unused accounts and releases identifiers on retained exam-history accounts. Removed the previously deleted unused invigilator that caused the email conflict; verified no user row remains for its ID or email.

Immediate credentials delivery after committed allocation/reissue is implemented. Isolated checks confirm targeted delivery to the registered email, erasure after success, and encrypted queued retry on SMTP failure. No additional student allocation or password reset was performed during this change.
