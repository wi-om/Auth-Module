-- Schema only. Data migration/purge runs in enforceAdminProductStorageSeparation() AFTER
-- credentials are copied into auth_admin_oauth_config (never delete-before-copy).

CREATE TABLE IF NOT EXISTS auth_admin_plugins (
  company_id TEXT NOT NULL,
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  version TEXT NOT NULL,
  plugin_type TEXT NOT NULL,
  manifest JSONB NOT NULL,
  source_filename TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, id)
);
