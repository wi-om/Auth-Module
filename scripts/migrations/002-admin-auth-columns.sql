-- Admin sign-in method (password or OAuth provider id).

ALTER TABLE auth_admins ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password';
ALTER TABLE auth_admins ADD COLUMN IF NOT EXISTS oauth_subject TEXT;
ALTER TABLE auth_admins ALTER COLUMN password_hash DROP NOT NULL;
