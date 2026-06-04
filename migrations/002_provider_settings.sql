-- Per-provider configuration: enable flag + OAuth client credentials.
CREATE TABLE IF NOT EXISTS auth_provider_settings (
  provider VARCHAR(32) PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  client_id VARCHAR(512) NOT NULL DEFAULT '',
  client_secret VARCHAR(512) NOT NULL DEFAULT '',
  extra_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO auth_provider_settings (provider, enabled, client_id, client_secret)
VALUES
  ('password', TRUE, '', ''),
  ('google', FALSE, '', ''),
  ('github', FALSE, '', ''),
  ('facebook', FALSE, '', ''),
  ('linkedin', FALSE, '', ''),
  ('entra', FALSE, '', '')
ON CONFLICT (provider) DO NOTHING;
