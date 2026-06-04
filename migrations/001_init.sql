-- Stores runtime auth configuration, including currently enabled providers.
CREATE TABLE IF NOT EXISTS auth_runtime_settings (
  id UUID PRIMARY KEY,
  settings_key VARCHAR(64) NOT NULL UNIQUE,
  enabled_providers TEXT[] NOT NULL DEFAULT ARRAY['password']::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Core local user table for password-based authentication.
CREATE TABLE IF NOT EXISTS auth_users (
  id UUID PRIMARY KEY,
  login_email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Maps external OAuth provider identities to local users.
CREATE TABLE IF NOT EXISTS auth_oauth_identities (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL,
  provider_subject VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_subject)
);
