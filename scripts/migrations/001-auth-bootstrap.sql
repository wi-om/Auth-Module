-- Auth microservice bootstrap schema (idempotent).
-- Run against product DB or dedicated auth DB.

CREATE TABLE IF NOT EXISTS auth_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_admins (
  id UUID PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_admins_email_lower_uq ON auth_admins (LOWER(email));

-- companies + auth_provider_* are created in code (companyIdType.ts / productDbConfig.ts)
-- so company_id FK matches existing companies.id (UUID or TEXT).
