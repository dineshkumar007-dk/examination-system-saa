# Examination portal upgrade — 9 November 2026

## Architecture and compatibility

The application remains React/Vite → Express → managed MySQL over verified TLS. Authentication retains bcrypt, HttpOnly sessions, CSRF, per-role sign-in, persistent rate limits and the administrator's page-memory proof. Candidate accounts continue using the existing `candidate` database role. Invigilator admission, assigned workstation browser credentials, schedules, fee simulation, hall tickets, saved-answer revisions, server deadlines and delayed result publication are preserved.

React now loads management, examination and examiner screens as separate chunks. Upload parsing runs on the server. There is no browser-side model, generated answer key, public upload directory or replacement database.

## Role boundaries and examiner workflow

| Role          | Allowed                                                                                                                  | Denied                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Administrator | Create/manage staff; assign Examiner; schedule/activate exams; admission; evaluate/publish results                       | PowerPoint uploads, paper creation/editing, examiner draft/source/key APIs, old question authoring APIs |
| Examiner      | Own assigned exams; own draft creation/upload/edit/delete; manual keys; preview; immutable published-paper/source review | Other examiners' papers, staff/user management, role changes, unrelated admin APIs                      |
| Candidate     | Registration, own hall ticket/admission/attempt/answers, released scores                                                 | Staff/paper/source/key APIs                                                                             |
| Invigilator   | Existing center-scoped attendance and workstation workflows                                                              | Paper authoring, admin management                                                                       |

1. Admin opens **Users → Create staff account**, selects **Examiner**, and supplies a strong password through the existing form. No public signup grants staff privileges.
2. Admin opens **Examinations → Assign Examiner**, chooses an active Examiner and saves. Published/active examination assignments are locked. Reassignment of an unpublished exam does not transfer ownership of someone else's draft.
3. Examiner signs in at `/examiner-login`, opens **Create Question Paper**, selects the assigned exam and enters title, subject, description, duration and total marks. Duration must match the administrator's scheduled examination.
4. Upload `.pptx`, inspect **Question Preview**, compare the original slide text/figures, correct numbering/options/text and resolve all review issues. Image-only content can be transcribed explicitly; figures can be attached from a source slide.
5. Open **Answer Key Entry**. Choose each answer or apply numbered bulk entries such as `1) B`, `2) A`. Missing, duplicate or unknown numbers/answers produce errors. Bulk entry does not infer answers.
6. Save a draft at any time. Draft revisions prevent lost concurrent edits. Review every slide, question, option, issue and key; then publish. Publication requires complete keys, unique numbers, valid options and matching total marks.
7. Publication atomically copies verified MCQs into the existing `questions`, `question_options`, and server-only `answer_keys` tables. It is blocked if any attempt exists, and published papers are immutable. Students use the existing CBT and grading workflows.

Legacy Examiner accounts disabled by migration 006 are not silently reactivated. Admin can explicitly reactivate an appropriate account or create a new one. Existing examinations without an Examiner assignment retain their historical question/attempt compatibility; assignment-based new exams require a published paper before activation.

## PowerPoint extraction and storage

Use editable text with explicit numbering, for example:

```text
Question 1: Which data structure follows FIFO?
A) Stack
B) Queue
C) Tree
D) Graph
```

The correct answer belongs in the portal, not the slides. PPTX processing follows presentation relationship order, reads text boxes/paragraphs in shape position order, and supports clear option continuations across slides. PNG/JPEG images are preserved. Unassigned text, missing/duplicate options or question numbers, scanned slides, grouped objects and charts/tables are reported for review. Source slide text/figures remain available to the Examiner; nothing is silently discarded. Obvious answer annotations are ignored and flagged rather than treated as keys.

Limits: 3 MiB upload; 300 slides/questions; 1,500 ZIP entries; 24 MiB total expansion; 10 MiB per expanded entry; 2 MiB per XML part; 128 XML nesting levels; 256 KiB per figure and 768 KiB total imported figures. Draft JSON is bounded separately. Unsafe paths, duplicate/encrypted ZIP entries, external entities, VBA/ActiveX and embedded files are rejected. Only PNG/JPEG image signatures are accepted. The parser never executes document content or fetches external relationships.

Original bytes, filename and SHA-256 are stored on the paper row in MySQL. Downloads require the owning, currently assigned Examiner session. Sources and keys have no public static URLs and are never committed to Git. Student question delivery selects safe question fields, figures and options; it never queries the key table. Scores remain hidden until the existing result-release step.

### Legacy PPT

Legacy binary PPT is accepted only when a self-hosted operator explicitly configures `LIBREOFFICE_PATH`. Conversion uses fixed arguments, an isolated temporary profile, macro security, bounded output and a timeout; temporary files are cleaned. Run that converter in a restricted worker/container with network access disabled. The converter is not installed or executed automatically by this project.

Vercel does not supply this executable. On Vercel, binary PPT produces an actionable 415 response asking the Examiner to **Save As PPTX**. Direct legacy conversion was not exercised on this Windows host because no converter was available; rejection/fallback behavior was tested. This is not OCR: image-only questions require human transcription/review.

## Measured performance and changes

Raw measurements are in `docs/performance/*.json`. `scripts/benchmark-upgrade.js` performs read-only queries against the configured managed DB and records three samples plus bundle sizes. Values below are medians of those three samples, not representative load-test percentiles.

| Measurement                                    |        Before |         After |
| ---------------------------------------------- | ------------: | ------------: |
| Admin overview data workflow                   |     294.37 ms |      31.96 ms |
| Password verification service (bcrypt cost 12) |     324.51 ms |     311.56 ms |
| Managed DB single round trip                   |      36.93 ms |      30.54 ms |
| Initial JavaScript, raw                        | 287,058 bytes | 249,590 bytes |
| Initial JavaScript, gzip using the same script |  86,154 bytes |  77,267 bytes |

The overview benchmark exercises the former catalog fan-out versus the current overview-only data path. Network variability and warm connections affect timings; the password service improvement is small and no bcrypt work factor was reduced. Feature-specific chunks are fetched later, so the combined bundle size is larger than the initial payload now that Examiner functionality exists.

Evidence and fixes:

- Admin overview formerly fetched examinations, centers, slots, one computer list per center, then overview. It now makes one overview request. Candidate overview combines registrations/profile in one request. Other views request only needed catalogs. Short-lived reference metadata caches are per mounted workspace, clear after mutation/logout, and contain no paper keys. Admission, slots, attempts, answers and results are not cached.
- Authoring's old per-question options query loop is removed with the retired authoring API. Publication uses batch inserts. Student retrieval groups the existing batched options in a map instead of repeatedly filtering all options.
- Timer polling uses `/api/exam/status`: three admission-validation queries, without fetching questions/options/answers on each poll. It uses the same server authorization and deadline finalization path. The browser countdown uses a monotonic clock and continues during network loss; expiry polling is bounded. Failed saves retain the current draft and prevent navigation; identical retries are idempotent and conflicting revisions remain errors. Network requests time out visibly rather than leaving controls pending forever.
- Login's persistent rate limiter now uses an atomic MySQL upsert and returns that request's own counter in the OK packet. It eliminates several transaction round trips without cached permission decisions. A real test sends 20 concurrent requests and verifies exactly five pass a five-request limit, then verifies expiry reset.
- Grading reads answers and published-result locks in batches, maps answers by attempt/question, and upserts score batches of 250 instead of queries per attempt. Exam locks still serialize grading/publication, and published results cannot be overwritten.
- MySQL retains a bounded TLS connection pool and queue, with keepalive/idle settings. Migrations add indexes for common ownership, role/status, registration history and examination-list queries. The redundant question covering index is removed because the existing unique exam/position index already covers that lookup.
- Private API responses and HTML remain `no-store`; hashed static assets retain immutable caching. The Express/Vercel stack is unchanged. Uploads stay below [Vercel's documented function payload limit](https://vercel.com/docs/functions/limitations).

`integration-before-rate-limit.json` and `integration.json` contain additional single-run HTTP/service timings in the isolated database. Their fixture passwords use bcrypt cost 4 solely to keep integration tests fast; these must not be represented as production password timings. Cold-start/network variance is visible, and no production student submission was used as a benchmark. Full representative concurrency/load testing remains an operator task before a large examination.

## Migrations, dependencies and run commands

New migration 007 adds examiner assignments, question paper metadata/private sources/draft JSON, question figures and indexes. Migration 008 refines the dashboard/history indexes. Neither resets users, examinations, answers or results. They have been applied to the configured managed DB and the isolated test DB.

```powershell
cd 'D:\saa project\SAA - FINAL\exampro'
npm.cmd ci
npm.cmd run db:migrate
npm.cmd run dev
```

Open `http://localhost:3000`. Existing `.env` configuration is retained; `.env.example` documents the optional converter. For UI hot reload use the existing `dev:ui` workflow and set `APP_URL` to its browser origin. Real SMTP settings and the existing job scheduler remain necessary for email/outbox delivery. No new external service is needed for PPTX.

Production dependencies added: `yauzl` for bounded lazy ZIP reads and `fast-xml-parser` for XML processing. Test dependencies `pptxgenjs` and `jszip` generate real slides and adversarial archives. A patched `image-size` override is used only by the fixture-generation dependency. Dependency audit is clean after compatible security updates.

```powershell
npm.cmd test
npx.cmd --no-install eslint backend frontend/react scripts/check.js scripts/benchmark-upgrade.js scripts/upgrade-ui-fixture.js tests app.js eslint.config.js vite.config.js
npm.cmd audit
node scripts/benchmark-upgrade.js
```

The existing uncommitted PDF generator work is separate; its pre-existing lint issues are not changed by this upgrade. Do not stage the entire workspace indiscriminately.

For real MySQL integration, select a dedicated migrated database ending in `_test`; the new upgrade test additionally requires the generated `exampro_upgrade_<8 hex characters>_test` naming pattern. `.env.upgrade-test` records the local generated DB name without duplicating credentials and is ignored by Git.

```powershell
$env:DB_NAME = (Get-Content .env.upgrade-test).Split('=')[1].Trim()
$env:INTEGRATION_TESTS = 'true'
npm.cmd run test:integration
```

Run those commands in a separate terminal so the production DB name is not replaced in your normal development server. Tests create UUID-scoped fixtures, do not send OTP/invitation email, and clean their own fixture data. The test database is retained for repeatability.

## Validation and deployment

The proposed release snapshot passes 58 unit/mocked/HTTP checks and both real-MySQL integration workflows. The full local workspace has one additional pre-existing uncommitted admission-diagnostic test (59 passing locally); that unrelated change is not included in this release. Production build, application-scoped ESLint and dependency audit pass. Browser QA confirmed extraction, individual/bulk manual keys, draft saving, publication locking, and a mobile layout without horizontal overflow.

Validation covers existing authentication/admission/revision/deadline/grading behavior; role and owner isolation; valid generated PPTX; source privacy; malformed options/duplicates; image and continuation order; missing/manual/bulk keys; malicious macros/entities/ZIP expansion; publication locking; and a real MySQL + HTTP uploaded-paper/student-submission/grading workflow. The existing real MySQL workflow also passes.

Browser QA uses a clearly named test Examiner in the isolated database via `scripts/upgrade-ui-fixture.js`, with credentials and a generated deck only under ignored `test-results/`. It exercises the real React upload, preview and key UI; there is no production mock mode.

Vercel: keep the existing Express preset and `npm run build`. Apply migrations before deploying; keep `NODE_ENV=production`, the canonical HTTPS `APP_URL`, DB TLS configuration, encryption keys and job scheduler. Set deployment region close to the managed DB if your Vercel plan supports it; the current region was not changed without measured regional comparisons. Confirm `/api/health`, Examiner sign-in, admin denial on paper APIs, and a supervised examination smoke test. Existing retired Examiners need explicit administrator reactivation/assignment.

PPTX requires no manual service provisioning. Legacy conversion and representative large-exam load testing remain the documented limitations above.

## File inventory

See `docs/UPGRADE-FILES.md` for the release's modified/new source and test files. Existing unrelated Render/PDF/diagnostic edits are preserved separately.

Implementation references: [yauzl's bounded lazy-entry API](https://github.com/thejoshwolfe/yauzl), [Microsoft's legacy PowerPoint stream format](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/1fc22d56-28f9-4818-bd45-67c2bf721ccf), [PowerPoint file-format guidance](https://support.microsoft.com/en-us/powerpoint/file-formats-that-are-supported-in-powerpoint).
