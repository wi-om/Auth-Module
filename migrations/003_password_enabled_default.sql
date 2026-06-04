-- Ensure email/password provider exists and is enabled by default for login/register.
INSERT INTO auth_provider_settings (provider, enabled, client_id, client_secret)
VALUES ('password', TRUE, '', '')
ON CONFLICT (provider) DO UPDATE SET
  enabled = TRUE,
  updated_at = NOW();
