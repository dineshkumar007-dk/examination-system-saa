UPDATE users SET status='active' WHERE role='candidate' AND status='pending' AND email_verified_at IS NOT NULL;
