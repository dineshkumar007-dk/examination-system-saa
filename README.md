# EXAMPRO

EXAMPRO conducts centralized computer-based examinations at authorized centers. It connects candidate registration, verified email, center and slot allocation, invigilator admission, assigned workstations, saved examination responses, and results that remain private until publication.

This is a separate project. No previous application is imported or modified. Production uses managed MySQL, real SMTP email. Payment is an explicitly labeled academic simulation; no money is collected.

## Structure

```text
frontend/                     HTML screens, Bootstrap, CSS, vanilla JS
backend/src/app.js            Express application and security headers
backend/src/controllers/     Authentication request handlers
backend/src/routes/          REST routes and role/ownership checks
backend/src/services/        Authentication, registration, allocation, exam logic, delivery
backend/src/config/          Environment and TLS MySQL connection pool
backend/src/middleware/      Sessions, CSRF, authorization, persistent rate limits
backend/src/utils/           Validation, hashing, encryption, date utilities
database/migrations/         Versioned MySQL schema
scripts/                     Migration, bootstrap, jobs, checks and real-provider test
tests/                       Unit, mocked delivery and HTTP tests
tests/integration/           Opt-in real MySQL workflow test
public/                      Generated deployment assets; ignored by Git
app.js                       Vercel Express entry point
vercel.json                  Build, static-page URLs, production headers
```

Use Node.js **24 LTS** and npm. Node 22 supports the application, but the isolated module-mocking tests require a recent Node release with `--experimental-test-module-mocks` (Node 24 is verified here). No frontend bundler or TypeScript compiler is needed for this JavaScript stack. `npm run build` checks syntax and prepares actual deployment assets.

## Run locally

In PowerShell:

```powershell
cd 'D:\saa project\SAA - FINAL\exampro'
npm.cmd ci
Copy-Item .env.example .env
# Edit .env with your managed database and provider configuration.
npm.cmd run db:check
npm.cmd run db:migrate
npm.cmd run admin:create
npm.cmd run dev
```

Open http://localhost:3000. Missing credentials produce a real setup error. There is no fallback database, fixed OTP, seeded user, or demo authentication. `npm run jobs` sends pending notifications and finalizes expired attempts during local development; arrange a recurring external invocation for deployed environments.

Generate **three independent secrets**, running this command separately for `APP_SECRET`, `DATA_ENCRYPTION_KEY`, and `CRON_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never put secrets in frontend files, screenshots, Git, or command arguments. `.env` is ignored. Preserve the encryption key through deployments: changing it makes existing encrypted notification payloads unreadable. Rotating `APP_SECRET` invalidates sessions, outstanding OTPs, and activation links; plan a maintenance window and reissue them.

## Hosted MySQL from zero

Selected provider: **Aiven for MySQL**, which documents a free tier suitable for getting started. Verify current availability, limits, and upgrade options in the [free-tier documentation](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier). A real competitive examination needs tested connection capacity, backups, monitoring and an appropriate paid service; the entry-level plan is not a throughput guarantee.

1. Create an Aiven account and project. Create a MySQL service using the [official getting-started guide](https://aiven.io/docs/products/mysql/get-started). Choose a region near your backend if your selected plan supports region selection.
2. Wait for the service to become available. Record the service hostname, port, administrator username and password. Download its CA certificate. Do not guess a port or disable certificate validation.
3. Using the provider's SQL console or a TLS MySQL client, create a database named `exampro`. If only the provided database is available on your plan, use that name in `DB_NAME` instead.
4. Temporarily configure `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` with migration-operator credentials in your local `.env`. Encode the downloaded CA file:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\path\to\ca.pem'))
   ```

   Put the result in `DB_SSL_CA_BASE64`. The application verifies the CA and hostname through the MySQL driver's TLS connection. See [Aiven TLS certificates](https://aiven.io/docs/platform/concepts/tls-ssl-certificates).

5. Run `npm run db:check`, then `npm run db:migrate`. The runner locks migrations, verifies checksums, and records successful versions. MySQL DDL is not transactionally rollbackable: if an initial migration fails, inspect the error and repair the dedicated database before retrying. Never edit a previously applied migration; add a new version.
6. Set `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters. Run `npm run admin:create`. The one-time CLI provisions the trusted operator account and refuses when any administrator already exists. Remove the bootstrap password from the environment immediately. This is an operator assertion of a trusted admin email, not an email-delivery verification claim. Public signup can only create candidates.
7. Create a separate runtime service user using [Aiven's user-management guide](https://aiven.io/docs/products/mysql/howto/manage-service-users). Grant only `SELECT, INSERT, UPDATE, DELETE` on the application tables. Grant `SELECT, INSERT` on `audit_logs`; grant only `SELECT` on `schema_migrations`. Grant no `CREATE`, `ALTER`, `DROP`, or user-management privileges to the deployed application. Do not grant blanket privileges across other databases. If your service tier restricts custom grants, choose a tier that supports the required privileges before production.
8. Replace the deployed `DB_USER` and `DB_PASSWORD` with this runtime user. Keep privileged migration credentials in an operator environment only. Limit `DB_POOL_SIZE` to 3 initially; size the managed database for the aggregate pools across serverless instances.

The schema includes users, candidate profiles, sessions, verification records, rate limits, examinations, registrations, simulated payments, centers, computers, slots, allocations, hall tickets, activation tokens, workstation credentials, questions, options, server-only answer keys, attempts, answers, results, an encrypted notification outbox, and audit logs. Foreign keys and unique constraints protect duplicate contacts, registrations, slot computer assignments and attempts.

## Real email configuration

Selected provider: **Resend SMTP via Nodemailer**. Follow [Resend's SMTP instructions](https://resend.com/docs/send-with-smtp).

1. Create a Resend account, add a domain you control and complete the provided DNS records for sender verification (including the specified DKIM/SPF records).
2. Create a sending API key. Set `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=resend`, `SMTP_PASSWORD=<API key>`.
3. Set `SMTP_FROM=EXAMPRO <exams@your-verified-domain>` using a sender on that domain. Sending to arbitrary personal destinations requires a correctly verified sending configuration.
4. Test email code delivery with your own mailbox. Check provider delivery events and spam placement; SMTP acceptance alone does not prove inbox receipt.

Email OTPs use cryptographic randomness, ten-minute expiry, a keyed digest in MySQL, five verification attempts, single-use consumption and a sixty-second resend cooldown. No code is returned from an API or logged. A resend replaces the previous email code. A failed send rolls back the verification update.

Registration, simulated-payment, allocation/hall-ticket, password-change, staff-invitation, announcement and result-publication emails use the persistent outbox. Job workers claim records with leases, retry delivery, and expose failures in the administrator dashboard. Payloads, including activation links, are encrypted at rest. Successful delivery erases the payload. Resend idempotency headers reduce duplicate sends during retries; they are subject to the provider's retention window. Delivery failures do not erase a registration.

## Contact verification

Email OTP is the only account verification requirement. Mobile numbers remain contact information in E.164 format; SMS OTP and Twilio configuration are not used. Existing pending candidates whose email is already verified are activated by migration `002_email_only_verification.sql`.

## Environment variables

All names and placeholders are in `.env.example`:

| Group                          | Variables                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Application                    | `NODE_ENV`, `PORT`, `APP_URL`, `APP_SECRET`, `DATA_ENCRYPTION_KEY`                            |
| Managed MySQL                  | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL_CA_BASE64`, `DB_POOL_SIZE` |
| SMTP                           | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`            |
| Scheduler                      | `CRON_SECRET`                                                                                 |
| Local bootstrap only           | `ADMIN_EMAIL`, `ADMIN_PASSWORD`                                                               |
| Disposable database tests only | `INTEGRATION_TESTS`                                                                           |
| Opt-in real delivery test only | `LIVE_TEST_CONFIRM`, `LIVE_TEST_EMAIL`, `LIVE_TEST_PHONE`                                     |

`APP_URL` is the **exact canonical origin**, such as `https://exams.example.com`. No OAuth callback is used. Password-setup links go to `/exam-setup#<single-use-token>`; fragments keep tokens out of normal HTTP URL logs. Recovery uses email OTPs on `/reset`. CORS is deliberately same-origin: frontend and API share one domain. POST/PUT/PATCH/DELETE require that origin and a signed CSRF cookie/header pair. Production cookies are Secure, HttpOnly and SameSite Strict.

## Connected examination workflow

Invigilators use `/invigilator-login` with their own administrator-created accounts. The server rejects candidate, examiner, and administrator credentials at this dedicated sign-in endpoint. In the invigilator dashboard, **Workstations → Grant exam access to this device** authorizes the browser for a specific center computer and exam slot. Staff then sign out before the assigned candidate signs in. The grant expires at the slot end or after eight hours, whichever is earlier. An ordinary home browser without the grant cannot start or save an exam. This browser authorization does not independently establish physical location: hall-only operation requires supervised devices and a center network or device certificate policy.

1. Operator creates an examination as draft, adds MCQ/MSQ/NAT questions, then opens registration with valid dates. Examiners may author question banks; only administrators assign staff access.
2. Candidate creates an account, requests a real email code on `/verify` and verifies it. A pending account can resume through `/resume`, but cannot access protected candidate features. After activation, complete the chosen exam registration from the dashboard. Each examination registration receives unique registration/application IDs.
3. If there is a fee, the candidate chooses an explicitly simulated successful or failed payment. A successful simulation marks the registration completed. Production payment collection is not implemented.
4. Operator adds active centers and computer inventory, creates nonoverlapping slots, closes exam registration and allocates eligible candidates. Slot capacity is locked transactionally; overbooking and duplicate PC assignments are rejected.
5. Allocation queues an email containing Registration ID, Hall ticket number and a generated examination password. The candidate downloads the PDF from the dashboard and may optionally change the generated password through the expiring setup link. Reissuing credentials before an attempt starts replaces the old password and link. Passwords are hashed in hall tickets and encrypted in queued email payloads, which are erased after sending.
6. Invigilator signs in for their assigned center, searches by registration/hall ticket, physically checks identity, records attendance and assigns a computer. The application records that the invigilator confirmed inspection; it does not automatically verify government documents.
7. On the actual workstation browser, the invigilator opens Workstations, selects the actual computer label and slot, then signs out. The short-lived workstation cookie remains for candidate use. Computer choices come from the center inventory; use an operator-controlled workstation inventory. This browser credential requires supervised kiosks, locked browser profiles and endpoint-management controls to bind operationally to a physical PC. A web page alone cannot prove hardware identity.
8. Operator activates the examination. Candidate signs into their account on the enrolled browser, opens the one centralized `/exam` portal and enters Registration ID, Hall Ticket Number and their separate exam password.
9. Every sensitive exam operation checks ownership, account status, verified contacts, registration eligibility, active exam/center/PC, attendance, assigned workstation/slot and time window. The attempt deadline is the earlier of its duration and the slot end. Question delivery excludes keys; server-side grading uses a separate answer-key table.
10. Candidate navigates, saves responses, reviews questions and submits through the count-confirmation dialog. Clear response writes a saved blank. Revision checks prevent conflicting writes; identical retried saves are idempotent. Unsaved browser edits cannot be recovered after a network loss or deadline. The browser displays save failures and does not navigate away on failure.
11. Saved answers are final when submitted or expired. Every sensitive request finalizes expired attempts; the jobs worker also finalizes abandoned attempts even if the browser closes. Exact write rejection uses the server deadline; the scheduled persisted submission update can lag by the scheduler interval.
12. Operator evaluates submitted attempts. Candidate scores remain null until explicit publication. Complete the exam once no live attempts remain, then publish. Published scores are locked against re-evaluation.

## Deploy on Vercel

Vercel now supports [Express applications](https://vercel.com/docs/frameworks/backend/express) as a single function. Static files must be under `public`; our build creates that directory. The application stays on the required Express/MySQL stack.

1. Create your own Git repository for **this directory**, commit the source and `package-lock.json`, and push it to your Git provider. Never commit `.env` or CA files.
2. Create a Vercel project and import that repository (or set its root to `exampro` if using a parent repository). Select Express, Node 24 and the `npm run build` command. Use `npm ci` for installation. Generated `public` assets are handled by the Express framework integration.
3. Add production environment variables from the table, with `NODE_ENV=production`, runtime MySQL credentials and your exact HTTPS `APP_URL`. Omit bootstrap and test-only variables. Set the database/network allowlist according to your managed-provider and Vercel networking options; do not disable TLS.
4. Deploy, attach your canonical domain, confirm HTTPS, update `APP_URL` if necessary and redeploy. Preview domains require separate configuration and databases if used; the origin check intentionally rejects a preview domain pointed at production's canonical origin.
5. Configure an authenticated scheduler to call **GET `/api/jobs` every minute** with `Authorization: Bearer <CRON_SECRET>`. Keep the secret in the scheduler's secure configuration. The checked-in Vercel config does not require a paid cron feature. On a Vercel plan supporting minute-level jobs, merge the `crons` field from `vercel.cron.example.json` into `vercel.json` and redeploy. [Vercel's cron documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs) states that Hobby cron is limited to daily execution; use an external scheduler on that plan. Alternatively run `npm run jobs` every minute on an always-on worker, using the same managed database. Never use a process-local timer inside a serverless function as a reliable job scheduler.
6. Test `/api/health` returns `status: ok`, open the landing page, download a Bootstrap asset, and verify the jobs endpoint rejects an absent/wrong bearer secret. Ensure queued email notifications reach `sent`.
7. Redeploy with unchanged database connection and encryption keys. Your users, allocations, sessions and saved answers persist in managed MySQL. Do not rerun initialization against an empty temporary filesystem. Use versioned migrations and tested backups for future changes.

For larger candidate counts, measure latency and concurrent connection limits, batch grading/announcements and scale the worker/database before opening a high-volume examination. This implementation uses synchronous grading and a small bounded outbox worker; it is not a claim of audited national-exam capacity.

## Tests and release checks

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
```

The regular suite includes pure validation/security checks, actual local HTTP middleware checks, and isolated **mocked** email/database service tests. Mock modules are installed by Node's test loader only; production cannot enable them. These tests do not prove real OTP receipt or hosted database correctness.

Real MySQL tests: create a separate disposable hosted database named `exampro_test`, configure it in an isolated `.env`, migrate it, set `INTEGRATION_TESTS=true`, then run:

```powershell
npm.cmd run test:integration
```

The test refuses a database name that does not end in `_test`. It exercises registration duplicates, simulated payment, concurrent capacity allocation, workstation admission, cross-user isolation, safe question delivery, saved-answer revisions, pool-restart persistence, expiry, locked answers, and private/published results. It uses explicitly verified fixture identities, does not send email, and deletes only its UUID-linked fixture data.

Real delivery test: set `LIVE_TEST_CONFIRM=yes`, `LIVE_TEST_EMAIL` and `LIVE_TEST_PHONE` to previously unused contacts **you own**, with working database/SMTP credentials, then run `node scripts/live-verification.js`. This creates a real account and sends an email code. Enter the received code interactively; the script verifies it and performs a persisted password login. Codes and generated passwords are not logged. Afterwards use Forgot password to access the integration account. If delivery fails, resume that account through recovery rather than repeatedly reserving the same contact identities.

Before release, test from two different browsers/devices:

- Personal-email signup, receipt of the email code, wrong/expired/replayed codes and resend limits; verify missing credentials and provider failures remain genuine errors.
- Duplicate email/phone/application rejection; unknown, incorrect, pending and disabled login; session restoration, logout and recovery invalidation.
- Candidate rejection on every staff API; invigilator rejection for another center; ownership checks on hall tickets, registrations and attempts.
- Two concurrent slot allocations and duplicate computer assignments; physical verification and workstation enrollment; reject off-center/off-slot/unverified/early/late exam access.
- MCQ/MSQ/NAT rendering, save/retry/conflict, clear/review, server deadline after browser clock changes and browser closure, repeated submission and rejection of edits after locking.
- Inspect candidate network responses for absent answer keys; inspect candidate results before evaluation, after evaluation and after explicit publication.
- Real hall-ticket/announcement emails, outbox retries, job scheduling, database backup/restore, restart and deployment persistence; load test the actual planned concurrent examination size.

## Verification limits and remaining setup

Aiven MySQL and Gmail SMTP have been configured locally. Real email OTP delivery and verification were confirmed through the browser. Production deployment and the disposable real-MySQL integration suite remain to be verified. Configure the scheduler before conducting an exam. Production payments, automated government-ID verification, hardware attestation, and QR hall-ticket scanning are not implemented; payments are simulation, ID checks are human invigilator actions, and hall tickets are downloadable PDFs. An independent security review and representative concurrency/load testing are needed before a high-stakes deployment.

Administrators can delete unused draft, open or closed examinations under Examinations. Confirmation explains that questions and unused slots are removed too. Exams with registrations, active exams and completed exams are protected; postpone registered exams by editing their schedule.

Admin → Users → Create staff account requires a login password and matching confirmation (at least 12 characters). Administrator-provisioned staff accounts are active immediately, with email trusted through administrative provisioning. Invigilators require an assigned center. The supplied password is bcrypt hashed; invitation notifications omit it. Older pending staff accounts can set their password and activate through Forgot password.

Admin → Users provides Delete for non-admin accounts. Confirmation revokes access and issued workstation grants, cancels pending notifications, and hides the account from the list. Unused accounts are permanently removed from users after related access records are removed. Accounts with registrations retain a disabled record for exam history, with their email replaced by an internal deleted address and their phone cleared, so both identifiers can be reused. Own-account and administrator deletion are blocked. Migration 003_user_deletion.sql must be applied.

After the allocation transaction commits, the allocation API immediately attempts delivery of its own credentials notification to the registered student email. Credential reissue behaves the same way. The admin UI reports sent versus queued; SMTP failure retains the encrypted payload and does not undo the allocation. The jobs scheduler remains responsible for retrying failed delivery and other queued notifications.
