import { Router } from 'express';
import multer from 'multer';
import { Pool } from 'pg';
import { parsePluginUpload } from './plugin/manifestParser';
import { resolvePluginRedirectUri } from './plugin/oauthRedirectUri';
import { reloadRuntimeFromSetup } from './runtimeSync';
import { getBootstrapFromProductDb } from './productDbConfig';
import {
  buildDatabaseUrl,
  countAdmins,
  probeSchema,
  testAndPrepareConnection,
  type ConnectionInput,
  type DbMode,
} from './bootstrapDb';
import { getBootstrapStatus } from './bootstrapService';
import { parseDatabaseUrlForSetupForm } from './setupConnectionPreview';
import { registerAdmin, loginAdmin } from './adminAuth';
import {
  enforceAdminProductStorageSeparation,
  listAdminOnlyProviderIds,
  loadAdminProviderContext,
  resolveAdminAuthProviderId,
} from './adminOAuthConfig';
import {
  completeAdminOAuthCallback,
  ensureProductProviderRowSeparatedFromAdmin,
  getAdminLoginMethod,
  isAdminSetupOAuthRedirectUri,
  listAdminRegisterOptions,
  prepareAdminOAuthProvider,
  startAdminOAuth,
} from './setupAdminAuth';
import {
  listProductInstalledProviderIds,
  PRODUCT_SIGN_IN_FLAG,
  shouldHideFromEndUserProviderList,
} from './productProviderFilter';
import {
  redirectSetupAdminOAuthError,
  redirectSetupAdminOAuthSuccess,
} from './setupAdminRedirect';
import { loadSetupConfigHydrated, writeSetupConfig } from './setupStore';
import { requireSetupAdminIfComplete } from './setupAdminMiddleware';
import { exampleFilenameForPlugin, listPluginCatalog, readExamplePluginManifest } from './pluginCatalog';
import { ensurePasswordProvider, persistPluginManifest } from './setupPluginPersistence';
import { extractSetupBearer, requireSetupResumeAccess } from './setupResumeMiddleware';
import {
  clearSetupResumeAfterAdminCreated,
  getSetupResumeStatus,
  setupCreateResumePassword,
  setupVerifyResumePassword,
  verifySetupResumeSessionToken,
} from './setupResumeAuth';
import { assertClientHashedPassword } from './setupResumePassword';

export const setupRouter = Router();
setupRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024, files: 1 } });

const CLIENT_HASH_HEX = /^[a-f0-9]{64}$/i;

function parseDbMode(value: unknown): DbMode {
  return value === 'auth_only' ? 'auth_only' : 'product';
}

function connectionBody(body: Record<string, unknown>): ConnectionInput & { dbMode: DbMode } {
  return {
    databaseUrl: body.databaseUrl !== undefined ? String(body.databaseUrl) : undefined,
    host: body.host !== undefined ? String(body.host) : undefined,
    port: body.port !== undefined ? String(body.port) : undefined,
    user: body.user !== undefined ? String(body.user) : undefined,
    password: body.password !== undefined ? String(body.password) : undefined,
    database: body.database !== undefined ? String(body.database) : undefined,
    ssl: Boolean(body.ssl),
    dbMode: parseDbMode(body.dbMode),
  };
}

setupRouter.get('/bootstrap/status', async (req, res) => {
  const status = await getBootstrapStatus();
  const token = extractSetupBearer(req);
  const resumeSessionValid = Boolean(token && verifySetupResumeSessionToken(token));
  return res.json({ ...status, resumeSessionValid });
});

setupRouter.get('/resume/status', async (req, res) => {
  const status = await getSetupResumeStatus();
  const token = extractSetupBearer(req);
  const resumeSessionValid = Boolean(token && verifySetupResumeSessionToken(token));
  return res.json({ ...status, resumeSessionValid });
});

setupRouter.post('/resume/create', async (req, res) => {
  try {
    const { clientHashedPassword, clientHashedConfirmPassword } = req.body || {};
    const hash = assertClientHashedPassword(clientHashedPassword);
    const confirm = assertClientHashedPassword(
      clientHashedConfirmPassword ?? clientHashedPassword,
      'clientHashedConfirmPassword'
    );
    if (hash !== confirm) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    const resumeSessionToken = await setupCreateResumePassword(hash);
    return res.status(201).json({
      message: 'Temporary setup password saved. Use it to resume if you leave before creating an admin.',
      resumeSessionToken,
      resumeSessionValid: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save password';
    return res.status(400).json({ error: message });
  }
});

setupRouter.post('/resume/verify', async (req, res) => {
  try {
    const { clientHashedPassword } = req.body || {};
    const resumeSessionToken = await setupVerifyResumePassword(
      assertClientHashedPassword(clientHashedPassword)
    );
    return res.json({
      message: 'Resume access granted',
      resumeSessionToken,
      resumeSessionValid: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    return res.status(401).json({ error: message });
  }
});

/** OAuth browser callback — no Bearer header */
setupRouter.get('/admin/oauth/:provider/callback', async (req, res) => {
  try {
    const provider = String(req.params.provider);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const oauthError = typeof req.query.error === 'string' ? req.query.error : '';

    if (oauthError) {
      return res.redirect(redirectSetupAdminOAuthError(oauthError));
    }
    if (!code || !state) {
      return res.redirect(redirectSetupAdminOAuthError('Missing authorization code'));
    }

    const { accessToken, mode } = await completeAdminOAuthCallback(provider, code, state);

    if (mode === 'register') {
      const setup = await loadSetupConfigHydrated();
      if (setup) {
        await writeSetupConfig({ ...setup, bootstrapPhase: 'setup' });
      }
      await clearSetupResumeAfterAdminCreated();
    }

    return res.redirect(redirectSetupAdminOAuthSuccess(accessToken));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth failed';
    return res.redirect(redirectSetupAdminOAuthError(message));
  }
});

setupRouter.use(requireSetupResumeAccess);

setupRouter.get('/state', async (_req, res) => {
  const setup = await loadSetupConfigHydrated();
  if (!setup) return res.json({ configured: false });
  const status = await getBootstrapStatus();
  const connectionForm = parseDatabaseUrlForSetupForm(setup.databaseUrl, setup.dbMode);
  return res.json({
    configured: true,
    data: {
      companyId: setup.companyId,
      dbMode: setup.dbMode,
      bootstrapPhase: status.phase,
      connectionForm,
    },
  });
});

setupRouter.post('/connection/test', async (req, res) => {
  try {
    const { dbMode, ...conn } = connectionBody(req.body || {});
    const databaseUrl = buildDatabaseUrl(conn);
    const probe = await probeSchema(databaseUrl, dbMode);
    if (!probe.tablesExist) {
      const prepared = await testAndPrepareConnection({ ...conn, databaseUrl }, dbMode, { migrate: true });
      return res.json({
        message: 'Connection successful. Schema migrated.',
        migrated: prepared.migrated,
        warnings: prepared.warnings,
        missingTables: [],
      });
    }
    return res.json({
      message: 'Database connection successful. All required tables exist.',
      warnings: probe.warnings,
      missingTables: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    return res.status(400).json({ error: message });
  }
});

setupRouter.post('/connection/save', async (req, res) => {
  try {
    const { dbMode, ...conn } = connectionBody(req.body || {});
    const prepared = await testAndPrepareConnection(conn, dbMode, { migrate: true });

    await writeSetupConfig({
      databaseUrl: prepared.databaseUrl,
      companyId: prepared.companyId,
      dbMode,
      bootstrapPhase: 'register',
      setupCompletedAt: undefined,
    });
    await reloadRuntimeFromSetup();

    return res.json({
      message: 'Database connected. Create your admin account next.',
      companyId: prepared.companyId,
      migrated: prepared.migrated,
      warnings: prepared.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Save failed';
    return res.status(400).json({ error: message });
  }
});

setupRouter.get('/admin/register-options', async (_req, res) => {
  try {
    const options = await listAdminRegisterOptions();
    return res.json({ options });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load options';
    return res.status(400).json({ error: message });
  }
});

setupRouter.get('/admin/login-method', async (_req, res) => {
  try {
    const setup = await loadSetupConfigHydrated();
    if (!setup?.databaseUrl) {
      return res.status(400).json({ error: 'Setup connection not saved' });
    }
    const method = await getAdminLoginMethod(setup.databaseUrl);
    if (!method) {
      return res.status(404).json({ error: 'No admin login method configured' });
    }
    return res.json({ method });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load login method';
    return res.status(400).json({ error: message });
  }
});

setupRouter.post('/admin/oauth/prepare', async (req, res) => {
  try {
    const setup = await loadSetupConfigHydrated();
    if (!setup) return res.status(400).json({ error: 'Setup connection not saved' });
    const { provider, clientId, clientSecret, tenantId } = req.body || {};
    if (!provider || !clientId || !clientSecret) {
      return res.status(400).json({ error: 'provider, clientId, and clientSecret are required' });
    }
    const adminCount = await countAdmins(setup.databaseUrl);
    if (adminCount > 0) {
      return res.status(409).json({ error: 'An admin account already exists' });
    }
    await prepareAdminOAuthProvider(setup, {
      provider: String(provider),
      clientId: String(clientId),
      clientSecret: String(clientSecret),
      tenantId: tenantId !== undefined ? String(tenantId) : undefined,
    });
    if (setup.bootstrapPhase === 'complete') {
      await writeSetupConfig({ ...setup, bootstrapPhase: 'register' });
    }
    return res.json({ message: 'Provider ready for admin registration' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prepare failed';
    return res.status(400).json({ error: message });
  }
});

setupRouter.get('/admin/oauth/:provider/start', async (req, res) => {
  try {
    const mode = req.query.mode === 'login' ? 'login' : 'register';
    const provider = String(req.params.provider);
    const result = await startAdminOAuth(mode, provider);
    if (result.redirectUrl) {
      return res.json({ mode: 'redirect', redirectUrl: result.redirectUrl, label: result.label });
    }
    if (result.accessToken) {
      return res.json({ mode: 'token', accessToken: result.accessToken, label: result.label });
    }
    return res.status(400).json({ error: 'OAuth start failed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth start failed';
    return res.status(400).json({ error: message });
  }
});

setupRouter.post('/bootstrap/register', async (req, res) => {
  try {
    const { email, clientHashedPassword } = req.body || {};
    if (!email || !CLIENT_HASH_HEX.test(String(clientHashedPassword || ''))) {
      return res.status(400).json({
        error: 'email and clientHashedPassword (64-char hex) are required',
      });
    }

    const { accessToken, admin } = await registerAdmin(String(email), String(clientHashedPassword));

    const setup = await loadSetupConfigHydrated();
    if (setup) {
      await writeSetupConfig({
        ...setup,
        bootstrapPhase: 'setup',
      });
    }
    await clearSetupResumeAfterAdminCreated();

    return res.status(201).json({
      message: 'Admin account created',
      accessToken,
      admin: { id: admin.id, email: admin.email },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    const status = message.includes('already') ? 409 : 400;
    return res.status(status).json({ error: message });
  }
});

setupRouter.post('/admin/login', async (req, res) => {
  try {
    const { email, clientHashedPassword } = req.body || {};
    if (!email || !CLIENT_HASH_HEX.test(String(clientHashedPassword || ''))) {
      return res.status(400).json({
        error: 'email and clientHashedPassword (64-char hex) are required',
      });
    }
    const { accessToken, admin } = await loginAdmin(String(email), String(clientHashedPassword));
    return res.json({
      message: 'Login successful',
      accessToken,
      admin: { id: admin.id, email: admin.email },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    return res.status(401).json({ error: message });
  }
});

setupRouter.post('/bootstrap/complete', async (req, res) => {
  try {
    const setup = await loadSetupConfigHydrated();
    if (!setup) {
      return res.status(400).json({ error: 'Setup connection not saved' });
    }
    const completedAt = new Date().toISOString();
    await writeSetupConfig({
      ...setup,
      bootstrapPhase: 'complete',
      setupCompletedAt: completedAt,
    });
    return res.json({ message: 'Setup marked complete. Admin login required for changes.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to complete setup';
    return res.status(400).json({ error: message });
  }
});

setupRouter.get('/providers', requireSetupAdminIfComplete, async (_req, res) => {
  const config = await loadSetupConfigHydrated();
  if (!config) return res.status(400).json({ error: 'Setup connection not saved' });

  await enforceAdminProductStorageSeparation(config);
  const [{ adminAuthProvider, adminOnlyProviderIds }, data] = await Promise.all([
    loadAdminProviderContext(config),
    getBootstrapFromProductDb(config.databaseUrl, config.companyId),
  ]);

  const isEndUserProvider = (providerId: string, row: { extra_config?: Record<string, string> }) =>
    !shouldHideFromEndUserProviderList(providerId, row, adminOnlyProviderIds, adminAuthProvider);

  const pluginIds = new Set((data.plugins || []).filter((p) => p.plugin_type === 'oauth').map((p) => p.id));
  const providers = data.providers
    .filter((p) => isEndUserProvider(p.provider, p))
    .map((row) => {
      if (!pluginIds.has(String(row.provider))) return row;
      const current = (row.extra_config || {}) as Record<string, string>;
      const redirectUri = resolvePluginRedirectUri(String(row.provider));
      return {
        ...row,
        extra_config: {
          ...current,
          redirectUri,
          [PRODUCT_SIGN_IN_FLAG]:
            current[PRODUCT_SIGN_IN_FLAG] === 'true' ? 'true' : current[PRODUCT_SIGN_IN_FLAG] || 'true',
        },
      };
    });
  const plugins = (data.plugins || []).filter((p) => isEndUserProvider(p.id, {}));

  return res.json({
    providers,
    plugins,
    adminAuthProvider,
    adminOnlyProviderIds: [...adminOnlyProviderIds],
  });
});

setupRouter.put('/providers/:provider', requireSetupAdminIfComplete, async (req, res) => {
  const config = await loadSetupConfigHydrated();
  if (!config) return res.status(400).json({ error: 'Setup connection not saved' });

  const provider = String(req.params.provider).toLowerCase();
  const adminOnlyProviders = await listAdminOnlyProviderIds(config);
  const adminAuthProvider = await ensureProductProviderRowSeparatedFromAdmin(config);
  if (shouldHideFromEndUserProviderList(provider, {}, adminOnlyProviders, adminAuthProvider)) {
    return res.status(400).json({
      error:
        'This provider is reserved for setup admin sign-in (step 2). Add it again from the plugin store to configure end-user sign-in.',
    });
  }
  const { enabled, clientId, clientSecret, extraConfig } = req.body || {};
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const prev = await pool.query(
      `SELECT enabled, client_id, client_secret, extra_config FROM auth_provider_settings WHERE company_id=$1 AND provider=$2 LIMIT 1`,
      [config.companyId, provider]
    );
    const old = prev.rows[0] || {};
    const nextEnabled = typeof enabled === 'boolean' ? enabled : Boolean(old.enabled ?? provider === 'password');
    const nextClientId = clientId !== undefined ? String(clientId) : String(old.client_id || '');
    const nextClientSecret =
      clientSecret !== undefined && String(clientSecret).trim() !== '' && String(clientSecret) !== '••••••••••••'
        ? String(clientSecret)
        : String(old.client_secret || '');
    const nextExtra = {
      ...(old.extra_config || {}),
      ...((extraConfig && typeof extraConfig === 'object') ? extraConfig : {}),
    } as Record<string, string>;
    if (provider !== 'password') {
      if (!nextExtra.redirectUri || !String(nextExtra.redirectUri).trim()) {
        nextExtra.redirectUri = resolvePluginRedirectUri(provider);
      } else if (isAdminSetupOAuthRedirectUri(nextExtra.redirectUri)) {
        nextExtra.redirectUri = resolvePluginRedirectUri(provider);
      }
    }

    await pool.query(
      `INSERT INTO auth_provider_settings (company_id, provider, enabled, client_id, client_secret, extra_config, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())
       ON CONFLICT (company_id, provider)
       DO UPDATE SET enabled=EXCLUDED.enabled, client_id=EXCLUDED.client_id, client_secret=EXCLUDED.client_secret, extra_config=EXCLUDED.extra_config, updated_at=NOW()`,
      [config.companyId, provider, nextEnabled, nextClientId, nextClientSecret, JSON.stringify(nextExtra)]
    );
    await reloadRuntimeFromSetup();
    return res.json({ message: 'Provider saved and applied' });
  } finally {
    await pool.end();
  }
});

setupRouter.get('/plugins/catalog', requireSetupAdminIfComplete, async (_req, res) => {
  try {
    const catalog = listPluginCatalog();
    const config = await loadSetupConfigHydrated();
    let installedIds: string[] = [];
    if (config) {
      await enforceAdminProductStorageSeparation(config);
      const [{ adminAuthProvider, adminOnlyProviderIds: adminOnly }, data] = await Promise.all([
        loadAdminProviderContext(config),
        getBootstrapFromProductDb(config.databaseUrl, config.companyId),
      ]);
      installedIds = listProductInstalledProviderIds(
        data.providers || [],
        adminOnly,
        adminAuthProvider
      );
    }
    return res.json({ catalog, installedIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load catalog';
    return res.status(400).json({ error: message });
  }
});

setupRouter.post('/plugins/install/:id', requireSetupAdminIfComplete, async (req, res) => {
  try {
    const config = await loadSetupConfigHydrated();
    if (!config) return res.status(400).json({ error: 'Setup connection not saved' });

    const id = String(req.params.id).toLowerCase();
    if (id === 'password') {
      await ensurePasswordProvider(config);
      await reloadRuntimeFromSetup();
      return res.status(201).json({ message: 'Email & Password provider is ready' });
    }

    const adminAuthProvider = await ensureProductProviderRowSeparatedFromAdmin(config);
    const adminOnly = await listAdminOnlyProviderIds(config);
    const data = await getBootstrapFromProductDb(config.databaseUrl, config.companyId);
    const existing = (data.providers || []).find((p) => String(p.provider).toLowerCase() === id);
    if (
      existing &&
      shouldHideFromEndUserProviderList(id, existing, adminOnly, adminAuthProvider)
    ) {
      const { purgeEndUserProviderSettingsForAdminOAuth } = await import('./adminOAuthConfig');
      await purgeEndUserProviderSettingsForAdminOAuth(config, id);
    }

    const manifest = readExamplePluginManifest(id);
    await persistPluginManifest(config, manifest, exampleFilenameForPlugin(id));
    await reloadRuntimeFromSetup();
    return res.status(201).json({ message: `${manifest.label} added for product sign-in` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Install failed';
    return res.status(400).json({ error: message });
  }
});

setupRouter.post('/plugins/upload', requireSetupAdminIfComplete, upload.single('plugin'), async (req, res) => {
  const config = await loadSetupConfigHydrated();
  if (!config) return res.status(400).json({ error: 'Setup connection not saved' });
  if (!req.file?.buffer) return res.status(400).json({ error: 'plugin file required' });

  try {
    const parsed = parsePluginUpload(req.file.buffer, req.file.originalname);
    const pluginId = parsed.manifest.id.toLowerCase();
    const adminAuthProvider = await ensureProductProviderRowSeparatedFromAdmin(config);
    const adminOnly = await listAdminOnlyProviderIds(config);
    const data = await getBootstrapFromProductDb(config.databaseUrl, config.companyId);
    const existing = (data.providers || []).find(
      (p) => String(p.provider).toLowerCase() === pluginId
    );
    if (
      existing &&
      shouldHideFromEndUserProviderList(pluginId, existing, adminOnly, adminAuthProvider)
    ) {
      const { purgeEndUserProviderSettingsForAdminOAuth } = await import('./adminOAuthConfig');
      await purgeEndUserProviderSettingsForAdminOAuth(config, pluginId);
    }
    await persistPluginManifest(config, parsed.manifest, parsed.sourceFilename);
    await reloadRuntimeFromSetup();
    return res.status(201).json({ message: 'Plugin uploaded for product sign-in' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    return res.status(400).json({ error: message });
  }
});

setupRouter.delete('/plugins/:id', requireSetupAdminIfComplete, async (req, res) => {
  const config = await loadSetupConfigHydrated();
  if (!config) return res.status(400).json({ error: 'Setup connection not saved' });
  const id = String(req.params.id).toLowerCase();
  if (id === 'password') return res.status(400).json({ error: 'Cannot delete password provider' });
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await pool.query('DELETE FROM auth_provider_settings WHERE company_id=$1 AND provider=$2', [config.companyId, id]);
    await pool.query('DELETE FROM auth_provider_plugins WHERE company_id=$1 AND id=$2', [config.companyId, id]);
    await reloadRuntimeFromSetup();
    return res.json({ message: 'Plugin deleted and applied' });
  } finally {
    await pool.end();
  }
});

setupRouter.post('/reload', requireSetupAdminIfComplete, async (_req, res) => {
  await reloadRuntimeFromSetup();
  return res.json({ message: 'Runtime reloaded' });
});
