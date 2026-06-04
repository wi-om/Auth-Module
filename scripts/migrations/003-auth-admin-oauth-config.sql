-- Setup admin OAuth credentials (register step). End-user sign-in uses auth_provider_settings.
-- Table is also created at runtime by ensureAdminOAuthConfigTable() when company_id type is known.

CREATE TABLE IF NOT EXISTS auth_admin_oauth_config (
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  client_secret TEXT NOT NULL DEFAULT '',
  extra_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, provider)
);
