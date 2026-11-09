CREATE TABLE examiner_assignments (
 exam_id CHAR(36) PRIMARY KEY, examiner_id CHAR(36) NOT NULL, assigned_by CHAR(36), assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(exam_id) REFERENCES examinations(id), FOREIGN KEY(examiner_id) REFERENCES users(id), FOREIGN KEY(assigned_by) REFERENCES users(id), INDEX(examiner_id,exam_id)
);
CREATE TABLE question_papers (
 id CHAR(36) PRIMARY KEY, exam_id CHAR(36) NOT NULL, examiner_id CHAR(36) NOT NULL,
 title VARCHAR(150) NOT NULL, subject VARCHAR(150) NOT NULL, description TEXT NOT NULL,
 duration_minutes INT NOT NULL, total_marks DECIMAL(9,2) NOT NULL, status ENUM('draft','published') NOT NULL DEFAULT 'draft',
 document JSON NOT NULL, revision INT NOT NULL DEFAULT 1, source_name VARCHAR(200), source_sha256 CHAR(64), source_bytes MEDIUMBLOB,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), published_at DATETIME(3),
 FOREIGN KEY(exam_id) REFERENCES examinations(id), FOREIGN KEY(examiner_id) REFERENCES users(id), INDEX(examiner_id,status,updated_at), INDEX(exam_id,status)
);
ALTER TABLE questions ADD COLUMN media JSON NULL;
CREATE INDEX examinations_status_created ON examinations(status,created_at);
CREATE INDEX registrations_exam_created ON registrations(exam_id,created_at);
CREATE INDEX users_role_status ON users(role,status);
CREATE INDEX questions_exam_position ON questions(exam_id,position,id);
CREATE INDEX notifications_user_available ON notifications(user_id,available_at);
