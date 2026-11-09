# Upgrade file inventory

This release preserves the pre-existing Render server/proxy, admission diagnostic and PDF-generator working changes outside this release. It does not include `.env`, generated credentials, uploads, or browser fixtures.

| Change   | File                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Modified | `.env.example`                                                                                       |
| Modified | `README.md`                                                                                          |
| Modified | `backend/src/app.js`                                                                                 |
| Modified | `backend/src/config/database.js`                                                                     |
| Modified | `backend/src/controllers/auth-controller.js`                                                         |
| Modified | `backend/src/middleware/security.js`                                                                 |
| Modified | `backend/src/routes/api.js`                                                                          |
| New      | `backend/src/routes/examiner.js`                                                                     |
| Modified | `backend/src/services/administration.js`                                                             |
| Modified | `backend/src/services/auth.js`                                                                       |
| Modified | `backend/src/services/exams.js`                                                                      |
| New      | `backend/src/services/powerpoint.js`                                                                 |
| New      | `backend/src/services/question-papers.js`                                                            |
| Modified | `backend/src/utils/validation.js`                                                                    |
| New      | `database/migrations/007_examiner_papers.sql`                                                        |
| New      | `database/migrations/008_dashboard_indexes.sql`                                                      |
| New      | `docs/UPGRADE.md`                                                                                    |
| New      | `docs/performance/after.json`                                                                        |
| New      | `docs/performance/baseline.json`                                                                     |
| New      | `docs/performance/http-baseline.json`                                                                |
| New      | `docs/performance/integration-before-rate-limit.json`                                                |
| New      | `docs/performance/integration.json`                                                                  |
| Modified | `frontend/react/src/api.js`                                                                          |
| New      | `frontend/react/src/exam-clock.js`                                                                   |
| Modified | `frontend/react/src/exam.jsx`                                                                        |
| New      | `frontend/react/src/examiner.css`                                                                    |
| New      | `frontend/react/src/examiner.jsx`                                                                    |
| Modified | `frontend/react/src/login-page.jsx`                                                                  |
| Modified | `frontend/react/src/login.css`                                                                       |
| Modified | `frontend/react/src/main.jsx`                                                                        |
| New      | `frontend/react/src/workspace-resources.js`                                                          |
| Modified | `frontend/react/src/workspace.jsx`                                                                   |
| Modified | `package-lock.json`                                                                                  |
| Modified | `package.json`                                                                                       |
| New      | `scripts/benchmark-http.js`                                                                          |
| New      | `scripts/benchmark-upgrade.js`                                                                       |
| Modified | `scripts/check.js`                                                                                   |
| New      | `scripts/upgrade-ui-fixture.js`                                                                      |
| Modified | `tests/auth-mocked.test.js`                                                                          |
| New      | `tests/exam-clock.test.js`                                                                           |
| Modified | `tests/exam-mocked.test.js`                                                                          |
| New      | `tests/helpers/powerpoint-fixture.js`                                                                |
| Modified | `tests/http.test.js`                                                                                 |
| New      | `tests/integration/upgrade.test.js`                                                                  |
| New      | `tests/performance-upgrade.test.js`                                                                  |
| New      | `tests/powerpoint.test.js`                                                                           |
| Modified | `tests/react-dashboard.test.js`                                                                      |
| Modified | `tests/staff-role.test.js`                                                                           |
| New      | `docs/UPGRADE-FILES.md`                                                                              |
| New      | `.gitattributes` (stable migration checksums across Windows/Linux)                                   |
| New      | `docs/performance/http-after.json` (post-deployment HTTP measurements and Admin authorization check) |
