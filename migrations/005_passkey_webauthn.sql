-- Passkey (WebAuthn) plugin type and credential storage.

ALTER TABLE auth_provider_plugins DROP CONSTRAINT IF EXISTS auth_provider_plugins_plugin_type_check;

ALTER TABLE auth_provider_plugins
  ADD CONSTRAINT auth_provider_plugins_plugin_type_check
  CHECK (plugin_type IN ('oauth', 'passkey'));

CREATE TABLE IF NOT EXISTS auth_webauthn_challenges (
  challenge_key VARCHAR(64) PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  flow VARCHAR(16) NOT NULL CHECK (flow IN ('registration', 'authentication')),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires ON auth_webauthn_challenges (expires_at);

CREATE TABLE IF NOT EXISTS auth_webauthn_credentials (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  device_type VARCHAR(32),
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user ON auth_webauthn_credentials (user_id);

-- Built-in passkey plugin manifest (upload passkey.plugin.json to replace/update).
INSERT INTO auth_provider_plugins (id, label, version, plugin_type, manifest, source_filename, source_checksum, updated_at)
VALUES (
  'passkey',
  'Passkey',
  '1.0.0',
  'passkey',
  '{
    "id": "passkey",
    "label": "Passkey",
    "version": "1.0.0",
    "type": "passkey",
    "passkey": {
      "rpName": "Auth App",
      "userVerification": "preferred",
      "authenticatorAttachment": "cross-platform",
      "attestationType": "none",
      "requireResidentKey": false,
      "allowConditionalMediation": true
    },
    "configFields": [
      { "key": "rpId", "label": "Relying Party ID (hostname)", "placeholder": "localhost" }
    ]
  }'::jsonb,
  'builtin/passkey.plugin.json',
  'builtin-passkey-v1',
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  version = EXCLUDED.version,
  plugin_type = EXCLUDED.plugin_type,
  manifest = EXCLUDED.manifest,
  updated_at = NOW();

INSERT INTO auth_provider_settings (provider, enabled, client_id, client_secret, extra_config, updated_at)
VALUES ('passkey', FALSE, '', '', '{}'::jsonb, NOW())
ON CONFLICT (provider) DO NOTHING;
