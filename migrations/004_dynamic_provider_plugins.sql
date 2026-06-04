-- Dynamic OAuth provider plugins (declarative manifests only; no server-side code execution).

CREATE TABLE IF NOT EXISTS auth_provider_plugins (
  id VARCHAR(64) PRIMARY KEY,
  label VARCHAR(128) NOT NULL,
  version VARCHAR(32) NOT NULL,
  plugin_type VARCHAR(16) NOT NULL DEFAULT 'oauth' CHECK (plugin_type IN ('oauth')),
  manifest JSONB NOT NULL,
  source_filename VARCHAR(255) NOT NULL DEFAULT '',
  source_checksum VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_provider_plugins_updated ON auth_provider_plugins (updated_at DESC);

-- Widen provider id column for custom plugin slugs.
ALTER TABLE auth_provider_settings
  ALTER COLUMN provider TYPE VARCHAR(64);

-- Built-in email/password only; remove hardcoded OAuth provider rows.
DELETE FROM auth_provider_settings
WHERE provider NOT IN ('password');

INSERT INTO auth_provider_settings (provider, enabled, client_id, client_secret, extra_config)
VALUES ('password', TRUE, '', '', '{}'::jsonb)
ON CONFLICT (provider) DO UPDATE SET enabled = TRUE, updated_at = NOW();
