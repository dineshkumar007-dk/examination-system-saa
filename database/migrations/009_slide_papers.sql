CREATE TABLE question_paper_slides (
 paper_id CHAR(36) NOT NULL, slide_number INT NOT NULL, image_bytes MEDIUMBLOB NOT NULL,
 PRIMARY KEY(paper_id,slide_number),
 FOREIGN KEY(paper_id) REFERENCES question_papers(id) ON DELETE CASCADE
);
ALTER TABLE questions ADD COLUMN slide_number INT NULL;
