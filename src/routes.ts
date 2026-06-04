import { Router } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { requireBearer, type AuthedRequest } from './middleware';
import { hashPassword, verifyPassword } from './password';
import { authAdapter } from './auth/authAdapter';
import { getFrontendOAuthErrorUrl } from './auth/oauthAdapter';
import {
  passkeyLoginOptions,
  passkeyLoginVerify,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
} from './auth/passkeyAdapter';
import {
  assertProviderReady,
  getAllProviderSettings,
  getPublicAuthOptions,
  getProviderSetting,
  setEnabledProviders,
  upsertProviderSetting,
} from './providers';
import { BUILTIN_PASSWORD_PROVIDER } from './providerSettings';
import { parsePluginUpload } from './plugin/manifestParser';
import { validatePluginManifest } from './plugin/manifestSchema';
import { deletePlugin, listPlugins, registerPlugin } from './plugin/pluginRegistry';
import { config } from './config';
import { loadSetupConfigHydrated } from './setupStore';
import { createProductUser, loginProductUser, requireSetup } from './productUserAuth';
import { sessionResponseForUser } from './productJwt';

export const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024, files: 1 },
});

router.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/auth/providers', async (_req, res, next) => {
  try {
    const providers = await getPublicAuthOptions();
    res.json({ providers });
  } catch (error) {
    next(error);
  }
});

router.get('/auth/me', requireBearer, (req: AuthedRequest, res) => {
  res.json({ user: req.auth });
});

const CLIENT_HASH_HEX = /^[a-f0-9]{64}$/i;

router.post('/auth/login', async (req, res, next) => {
  try {
    const setup = await loadSetupConfigHydrated();
    if (!setup?.databaseUrl || !config.userPepper || !config.jwtSecretForProduct) {
      void verifyPassword;
      void hashPassword;
      void authAdapter;
      void assertProviderReady;
      void BUILTIN_PASSWORD_PROVIDER;
      return res.status(501).json({
        error:
          'Password login requires completed /setup and AUTH_USER_PEPPER + JWT_SECRET in service env',
      });
    }
    const { email, clientHashedPassword } = req.body || {};
    if (!email || typeof clientHashedPassword !== 'string' || !CLIENT_HASH_HEX.test(clientHashedPassword)) {
      return res.status(400).json({
        error: 'email and clientHashedPassword (64-char hex) are required',
      });
    }
    await requireSetup();
    const user = await loginProductUser(String(email), clientHashedPassword);
    res.json(sessionResponseForUser(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    if (message === 'Invalid credentials' || message.includes('deactivated')) {
      return res.status(401).json({ error: message });
    }
    next(error);
  }
});

router.post('/auth/register', async (req, res, next) => {
  try {
    const setup = await loadSetupConfigHydrated();
    if (!setup?.databaseUrl || !config.userPepper || !config.jwtSecretForProduct) {
      return res.status(501).json({
        error: 'Registration requires completed /setup and env peppers/JWT_SECRET',
      });
    }
    const { name, email, phone, role, clientHashedPassword } = req.body || {};
    if (
      !name ||
      !email ||
      !phone ||
      !role ||
      typeof clientHashedPassword !== 'string' ||
      !CLIENT_HASH_HEX.test(clientHashedPassword)
    ) {
      return res.status(400).json({
        error: 'name, email, phone, role, and clientHashedPassword (64-char hex) are required',
      });
    }
    await requireSetup();
    const user = await createProductUser({
      name: String(name),
      email: String(email),
      phone: String(phone),
      role: String(role),
      clientHashedPassword,
    });
    res.status(201).json(sessionResponseForUser(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    if (message === 'Email already exists') {
      return res.status(409).json({ error: message });
    }
    next(error);
  }
});

router.get('/auth/oauth/:provider/start', async (req, res, next) => {
  try {
    const provider = String(req.params.provider);
    const result = await authAdapter.startOAuth(provider);

    if (result.mode === 'redirect' && result.redirectUrl) {
      return res.json({
        mode: 'redirect',
        provider: result.provider,
        redirectUrl: result.redirectUrl,
        state: result.state,
      });
    }

    res.json({
      message: `Signed in with ${result.label}`,
      provider: result.provider,
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/:provider/passkey/login/options', async (req, res, next) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const { email, origin } = req.body || {};
    const result = await passkeyLoginOptions(provider, {
      email: email !== undefined ? String(email) : undefined,
      origin: origin !== undefined ? String(origin) : undefined,
    });
    res.json({ sessionId: result.sessionId, options: result.options });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/:provider/passkey/login/verify', async (req, res, next) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const { sessionId, credential, origin } = req.body || {};
    if (!sessionId || !credential) {
      return res.status(400).json({ error: 'sessionId and credential are required' });
    }
    const result = await passkeyLoginVerify(provider, {
      sessionId: String(sessionId),
      credential,
      origin: origin !== undefined ? String(origin) : undefined,
    });
    res.json({
      message: 'Passkey login successful',
      provider,
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/:provider/passkey/register/options', async (req, res, next) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const { email, name, origin } = req.body || {};
    const result = await passkeyRegisterOptions(provider, {
      email: email !== undefined ? String(email) : undefined,
      name: name !== undefined ? String(name) : undefined,
      origin: origin !== undefined ? String(origin) : undefined,
    });
    res.json({ sessionId: result.sessionId, options: result.options });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/:provider/passkey/register/verify', async (req, res, next) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const { sessionId, credential, origin } = req.body || {};
    if (!sessionId || !credential) {
      return res.status(400).json({ error: 'sessionId and credential are required' });
    }
    const result = await passkeyRegisterVerify(provider, {
      sessionId: String(sessionId),
      credential,
      origin: origin !== undefined ? String(origin) : undefined,
    });
    res.json({
      message: 'Passkey registered',
      provider,
      user: result.user,
      accessToken: result.accessToken,
      registered: result.registered,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/:provider/passkey/register/options/authenticated', requireBearer, async (req: AuthedRequest, res, next) => {
  try {
    const provider = String(req.params.provider).toLowerCase();
    const { origin } = req.body || {};
    const result = await passkeyRegisterOptions(provider, {
      userId: req.auth!.sub,
      origin: origin !== undefined ? String(origin) : undefined,
    });
    res.json({ sessionId: result.sessionId, options: result.options });
  } catch (error) {
    next(error);
  }
});

router.get('/auth/oauth/:provider/callback', async (req, res, next) => {
  try {
    const provider = String(req.params.provider);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

    if (oauthError) {
      return res.redirect(getFrontendOAuthErrorUrl(oauthError));
    }

    const { redirectUrl } = await authAdapter.completeOAuthCallback(provider, code, state);
    res.redirect(redirectUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth callback failed';
    res.redirect(getFrontendOAuthErrorUrl(message));
  }
});

router.get('/auth/admin/providers', requireBearer, async (_req, res, next) => {
  try {
    const providers = await getAllProviderSettings(false);
    res.json({ providers });
  } catch (error) {
    next(error);
  }
});

router.get('/auth/admin/providers/:provider', requireBearer, async (req, res, next) => {
  try {
    const provider = String(req.params.provider);
    const setting = await getProviderSetting(provider, false);
    if (!setting) {
      return res.status(404).json({ error: 'Provider not found' });
    }
    res.json({ provider: setting });
  } catch (error) {
    next(error);
  }
});

router.put('/auth/admin/providers/:provider', requireBearer, async (req, res, next) => {
  try {
    const provider = String(req.params.provider);
    const { enabled, clientId, clientSecret, extraConfig } = req.body || {};
    const updated = await upsertProviderSetting(provider, {
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
      clientId: clientId !== undefined ? String(clientId) : undefined,
      clientSecret: clientSecret !== undefined ? String(clientSecret) : undefined,
      extraConfig: extraConfig && typeof extraConfig === 'object' ? extraConfig : undefined,
    });
    res.json({
      message: 'Provider settings saved',
      provider: {
        ...updated,
        clientSecretMasked: updated.clientSecretMasked,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/auth/admin/plugins', requireBearer, async (_req, res, next) => {
  try {
    const plugins = await listPlugins();
    res.json({ plugins });
  } catch (error) {
    next(error);
  }
});

router.post('/auth/admin/plugins/upload', requireBearer, upload.single('plugin'), async (req, res, next) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'Missing plugin file (field name: plugin)' });
    }

    const parsed = parsePluginUpload(req.file.buffer, req.file.originalname);
    const plugin = await registerPlugin(parsed.manifest, parsed.sourceFilename, parsed.checksum);
    const setting = await getProviderSetting(plugin.id, false);

    res.status(201).json({
      message: 'Plugin registered',
      plugin,
      provider: setting,
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/auth/admin/plugins/:id', requireBearer, async (req, res, next) => {
  try {
    const id = String(req.params.id).toLowerCase();
    if (id === BUILTIN_PASSWORD_PROVIDER) {
      return res.status(400).json({ error: 'Cannot delete built-in password provider' });
    }
    const removed = await deletePlugin(id);
    if (!removed) {
      return res.status(404).json({ error: 'Plugin not found' });
    }
    res.json({ message: 'Plugin removed', id });
  } catch (error) {
    next(error);
  }
});

router.get('/internal/auth/settings/providers', async (_req, res, next) => {
  try {
    const providers = await getAllProviderSettings(false);
    res.json({ providers });
  } catch (error) {
    next(error);
  }
});

router.put('/internal/auth/settings/providers/:provider', async (req, res, next) => {
  try {
    const { enabled, clientId, clientSecret, extraConfig } = req.body || {};
    const updated = await upsertProviderSetting(req.params.provider, {
      enabled: typeof enabled === 'boolean' ? enabled : undefined,
      clientId: clientId !== undefined ? String(clientId) : undefined,
      clientSecret: clientSecret !== undefined ? String(clientSecret) : undefined,
      extraConfig: extraConfig && typeof extraConfig === 'object' ? extraConfig : undefined,
    });
    res.json({ message: 'Provider settings saved', provider: updated });
  } catch (error) {
    next(error);
  }
});

router.put('/internal/auth/settings/providers', async (req, res, next) => {
  try {
    const providers = Array.isArray(req.body?.providers) ? req.body.providers : [];
    const enabled = await setEnabledProviders(providers);
    res.json({ message: 'Providers updated', providers: enabled });
  } catch (error) {
    next(error);
  }
});

router.get('/internal/auth/plugins', async (_req, res, next) => {
  try {
    const plugins = await listPlugins();
    res.json({ plugins });
  } catch (error) {
    next(error);
  }
});

router.post('/internal/auth/plugins/register', async (req, res, next) => {
  try {
    const { manifest: rawManifest, sourceFilename } = req.body || {};
    if (!rawManifest || typeof rawManifest !== 'object') {
      return res.status(400).json({ error: 'manifest object is required' });
    }
    const manifest = validatePluginManifest(rawManifest);
    const filename = sourceFilename ? String(sourceFilename) : `${manifest.id}.plugin.json`;
    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(manifest))
      .digest('hex');
    const plugin = await registerPlugin(manifest, filename, checksum);
    const setting = await getProviderSetting(plugin.id, false);
    res.status(201).json({
      message: 'Plugin registered',
      plugin,
      provider: setting,
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/internal/auth/plugins/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id).toLowerCase();
    if (id === BUILTIN_PASSWORD_PROVIDER) {
      return res.status(400).json({ error: 'Cannot delete built-in password provider' });
    }
    const removed = await deletePlugin(id);
    if (!removed) {
      return res.status(404).json({ error: 'Plugin not found' });
    }
    res.json({ message: 'Plugin removed', id });
  } catch (error) {
    next(error);
  }
});
