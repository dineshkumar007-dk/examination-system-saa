DROP INDEX questions_exam_position ON questions;
CREATE INDEX registrations_user_created ON registrations(user_id,created_at);
CREATE INDEX examinations_visible_created ON examinations(deleted_at,created_at);
CREATE INDEX question_papers_owner_updated ON question_papers(examiner_id,updated_at);
