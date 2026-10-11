ALTER TABLE examinations ADD COLUMN deleted_at DATETIME(3) NULL;
ALTER TABLE exam_slots ADD COLUMN deleted_at DATETIME(3) NULL;
