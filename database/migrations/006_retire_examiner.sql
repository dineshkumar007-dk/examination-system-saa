UPDATE users SET status='disabled' WHERE role='examiner';
DELETE s FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.role='examiner';
