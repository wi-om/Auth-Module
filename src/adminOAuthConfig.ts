import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import {
  invalidateAdminProductSeparation,
  isAdminProductSeparationReady,
  markAdminProductSeparationReady,
} from './adminProductSeparationCache';
import { getAuthSetting } from './bootstrapDb';
import { ensureOrganisationsTable } from './organisationIdType';
import { hasProductEndUserConfiguration } from './productProviderFilter';
import { resolveSetupAdminOAuthRedirectUri } from './setupAdminRedirect';
import { getSetupPool } from './setupDbPool';
import type { SetupConfig } from './setupStore';

const ADMIN_AUTH_PROVIDER_KEY = 'admin_auth_provider';
const adminOAuthConfigTableReady = new Set<string>();

function isAdminSetupRedirect(uri: string | undefined): boolean {
  if (!uri?.trim()) return false;
  const u = uri.trim();
  return /\/setup\/api\/admin\/oauth\//i.test(u) || /\/setup\/admin\/oauth\//i.test(u);
}

function isExplicitProductProviderRow(row: {
  provider: string;
  client_id?: string;
  enabled?: boolean;
  extra_config?: Record<string, string>;
}): boolean {
  return hasProductEndUserConfiguration(row);
}

export type AdminOAuthConfigRow = {
  provider: string;
  client_id: string;
  client_secret: string;
  extra_config: Record<string, string>;
};

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return Boolean(r.rowCount);
}

export async function ensureAdminOAuthConfigTable(databaseUrl: string): Promise<void> {
  if (adminOAuthConfigTableReady.has(databaseUrl)) return;

  const pool = getSetupPool(databaseUrl);
  const companyIdType = await ensureOrganisationsTable(pool);
  const cid = companyIdType;

  if (!(await tableExists(pool, 'auth_admin_oauth_config'))) {
    await pool.query(`
        CREATE TABLE auth_admin_oauth_config (
          company_id ${cid} NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
          provider TEXT NOT NULL,
          client_id TEXT NOT NULL DEFAULT '',
          client_secret TEXT NOT NULL DEFAULT '',
          extra_config JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (company_id, provider)
        )
      `);
  }

  adminOAuthConfigTableReady.add(databaseUrl);
}

export async function upsertAdminOAuthConfig(
  setup: SetupConfig,
  input: {
    provider: string;
    clientId: string;
    clientSecret: string;
    tenantId?: string;
  }
): Promise<void> {
  await ensureAdminOAuthConfigTable(setup.databaseUrl);
  const provider = input.provider.toLowerCase();
  const extraConfig: Record<string, string> = {
    redirectUri: resolveSetupAdminOAuthRedirectUri(provider),
    ...(input.tenantId?.trim() ? { tenantId: input.tenantId.trim() } : {}),
  };

  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    await pool.query(
      `INSERT INTO auth_admin_oauth_config (company_id, provider, client_id, client_secret, extra_config, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,NOW())
       ON CONFLICT (company_id, provider)
       DO UPDATE SET client_id=EXCLUDED.client_id, client_secret=EXCLUDED.client_secret,
         extra_config=EXCLUDED.extra_config, updated_at=NOW()`,
      [
        setup.companyId,
        provider,
        input.clientId.trim(),
        input.clientSecret.trim(),
        JSON.stringify(extraConfig),
      ]
    );
  } finally {
    await pool.end();
  }
}

export async function getAdminOAuthConfig(
  databaseUrl: string,
  companyId: string,
  provider: string
): Promise<AdminOAuthConfigRow | null> {
  await ensureAdminOAuthConfigTable(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const r = await pool.query<AdminOAuthConfigRow>(
      `SELECT provider, client_id, client_secret, extra_config FROM auth_admin_oauth_config
       WHERE company_id=$1 AND provider=$2 LIMIT 1`,
      [companyId, provider.toLowerCase()]
    );
    return r.rows[0] ?? null;
  } catch {
    return null;
  } finally {
    await pool.end();
  }
}

export async function listAdminOAuthConfigProviders(
  databaseUrl: string,
  companyId: string
): Promise<string[]> {
  await ensureAdminOAuthConfigTable(databaseUrl);
  const pool = getSetupPool(databaseUrl);
  try {
    const r = await pool.query<{ provider: string }>(
      `SELECT provider FROM auth_admin_oauth_config WHERE company_id=$1`,
      [companyId]
    );
    return r.rows.map((row) => row.provider);
  } catch {
    return [];
  }
}

/** Remove leaked product rows for an admin OAuth provider (keeps explicit end-user installs). */
export async function purgeEndUserProviderSettingsForAdminOAuth(
  setup: SetupConfig,
  provider: string
): Promise<void> {
  const pid = provider.toLowerCase();
  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    const settings = await pool.query<{
      client_id: string;
      enabled: boolean;
      extra_config: Record<string, string>;
    }>(
      `SELECT client_id, enabled, extra_config FROM auth_provider_settings
       WHERE company_id=$1 AND provider=$2 LIMIT 1`,
      [setup.companyId, pid]
    );
    const row = settings.rows[0];
    if (row && hasProductEndUserConfiguration(row)) {
      return;
    }

    await pool.query(
      `DELETE FROM auth_provider_settings WHERE company_id=$1 AND provider=$2`,
      [setup.companyId, pid]
    );
    await pool.query(
      `DELETE FROM auth_provider_plugins WHERE company_id=$1 AND id=$2`,
      [setup.companyId, pid]
    );
  } finally {
    await pool.end();
  }
}

/** Delete leaked product rows; keep rows explicitly installed for end-user sign-in. */
export async function purgeAllLeakedProductProviderRows(setup: SetupConfig): Promise<void> {
  await ensureAdminOAuthConfigTable(setup.databaseUrl);
  const adminProviders = new Set(
    (await listAdminOAuthConfigProviders(setup.databaseUrl, setup.companyId)).map((p) => p.toLowerCase())
  );

  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    const adminRow = await pool.query<{ auth_provider: string }>(
      `SELECT auth_provider FROM auth_admins ORDER BY created_at ASC LIMIT 1`
    );
    const fromAdmin = adminRow.rows[0]?.auth_provider?.trim().toLowerCase();
    if (fromAdmin && fromAdmin !== 'password') adminProviders.add(fromAdmin);

    const settings = await pool.query<{
      provider: string;
      client_id: string;
      enabled: boolean;
      extra_config: Record<string, string>;
      company_id: string | null;
    }>(
      `SELECT provider, client_id, enabled, extra_config, company_id
       FROM auth_provider_settings
       WHERE company_id = $1 OR company_id IS NULL`,
      [setup.companyId]
    );

    for (const row of settings.rows) {
      if (row.provider === 'password') continue;
      if (isExplicitProductProviderRow(row)) continue;

      const pid = row.provider.toLowerCase();
      const adminRedirect = isAdminSetupRedirect(row.extra_config?.redirectUri);
      const reservedForAdmin = adminProviders.has(pid) || adminRedirect;
      if (!reservedForAdmin) continue;

      await pool.query(
        `DELETE FROM auth_provider_settings WHERE provider = $1 AND (company_id = $2 OR company_id IS NULL)`,
        [row.provider, setup.companyId]
      );
    }

    const plugins = await pool.query<{ id: string; company_id: string | null }>(
      `SELECT id, company_id FROM auth_provider_plugins WHERE company_id = $1 OR company_id IS NULL`,
      [setup.companyId]
    );
    for (const row of plugins.rows) {
      const id = row.id.toLowerCase();
      if (!adminProviders.has(id)) continue;

      const stillProduct = settings.rows.some(
        (s) => s.provider.toLowerCase() === id && isExplicitProductProviderRow(s)
      );
      if (stillProduct) continue;

      await pool.query(
        `DELETE FROM auth_provider_plugins WHERE id = $1 AND (company_id = $2 OR company_id IS NULL)`,
        [row.id, setup.companyId]
      );
    }
  } finally {
    await pool.end();
  }
}

/** Run migration once per process (or after admin/product writes). */
export async function enforceAdminProductStorageSeparation(
  setup: SetupConfig,
  options?: { force?: boolean }
): Promise<void> {
  if (!options?.force && isAdminProductSeparationReady(setup)) return;

  const pool = getSetupPool(setup.databaseUrl);
  try {
    const migrationPath = path.resolve(
      __dirname,
      '../scripts/migrations/004-separate-admin-product-auth.sql'
    );
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf8');
      await pool.query(sql);
    }
  } catch (err) {
    console.warn('[auth] Admin/product separation migration skipped:', err);
  }

  await migrateLegacyAdminOAuthIntoTable(setup);
  await backfillAdminPluginsFromAdmins(setup);
  markAdminProductSeparationReady(setup);
}

export { invalidateAdminProductSeparation };

/** Ensure auth_admin_plugins rows exist for each admin OAuth provider. */
export async function backfillAdminPluginsFromAdmins(setup: SetupConfig): Promise<void> {
  const providers = await listAdminOAuthConfigProviders(setup.databaseUrl, setup.companyId);
  const { upsertAdminPluginFromCatalog } = await import('./adminPluginStore');
  for (const p of providers) {
    try {
      await upsertAdminPluginFromCatalog(setup, p);
    } catch {
      // unknown catalog id — skip
    }
  }
  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    const r = await pool.query<{ auth_provider: string }>(
      `SELECT auth_provider FROM auth_admins ORDER BY created_at ASC`
    );
    for (const row of r.rows) {
      const p = row.auth_provider?.trim().toLowerCase();
      if (!p || p === 'password') continue;
      const inCfg = providers.map((x) => x.toLowerCase()).includes(p);
      if (!inCfg) continue;
      try {
        await upsertAdminPluginFromCatalog(setup, p);
      } catch {
        // skip
      }
    }
  } finally {
    await pool.end();
  }
}

/** Migrate legacy auth_settings JSON + leaked product rows into auth_admin_oauth_config. */
export async function migrateLegacyAdminOAuthIntoTable(setup: SetupConfig): Promise<void> {
  await ensureAdminOAuthConfigTable(setup.databaseUrl);

  const { getAuthSetting, setAuthSetting } = await import('./bootstrapDb');
  const legacy = await getAuthSetting<{
    provider?: string;
    clientId?: string;
    clientSecret?: string;
    extraConfig?: Record<string, string>;
  }>(setup.databaseUrl, 'admin_oauth_credentials');

  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    if (legacy?.provider && legacy.clientId && legacy.clientSecret) {
      await upsertAdminOAuthConfig(setup, {
        provider: legacy.provider,
        clientId: legacy.clientId,
        clientSecret: legacy.clientSecret,
        tenantId: legacy.extraConfig?.tenantId,
      });
    }

    const admins = await pool.query<{ auth_provider: string }>(
      `SELECT auth_provider FROM auth_admins ORDER BY created_at ASC LIMIT 1`
    );
    const adminProvider = admins.rows[0]?.auth_provider?.toLowerCase();
    if (adminProvider && adminProvider !== 'password') {
      const leaked = await pool.query<AdminOAuthConfigRow>(
        `SELECT provider, client_id, client_secret, extra_config FROM auth_provider_settings
         WHERE company_id=$1 AND provider=$2 LIMIT 1`,
        [setup.companyId, adminProvider]
      );
      const row = leaked.rows[0];
      const existing = await getAdminOAuthConfig(
        setup.databaseUrl,
        setup.companyId,
        adminProvider
      );
      if (!existing?.client_id?.trim() && row?.client_id?.trim() && row?.client_secret?.trim()) {
        await upsertAdminOAuthConfig(setup, {
          provider: adminProvider,
          clientId: row.client_id,
          clientSecret: row.client_secret,
          tenantId: row.extra_config?.tenantId,
        });
      }
      await purgeEndUserProviderSettingsForAdminOAuth(setup, adminProvider);
    }

    const adminOnlyProviders = await listAdminOAuthConfigProviders(
      setup.databaseUrl,
      setup.companyId
    );
    for (const p of adminOnlyProviders) {
      await purgeEndUserProviderSettingsForAdminOAuth(setup, p);
    }
  } finally {
    await pool.end();
  }

  await purgeAllLeakedProductProviderRows(setup);

  for (const p of await listAdminOAuthConfigProviders(setup.databaseUrl, setup.companyId)) {
    await purgeEndUserProviderSettingsForAdminOAuth(setup, p);
  }

  const { deleteAuthSetting } = await import('./bootstrapDb');
  await deleteAuthSetting(setup.databaseUrl, 'admin_oauth_credentials');
}

/** Provider ids reserved for setup admin OAuth (read-only; does not run migrations). */
export async function listAdminOnlyProviderIds(setup: SetupConfig): Promise<Set<string>> {
  const ids = new Set(
    (await listAdminOAuthConfigProviders(setup.databaseUrl, setup.companyId)).map((p) =>
      p.toLowerCase()
    )
  );
  const pool = getSetupPool(setup.databaseUrl);
  try {
    const r = await pool.query<{ auth_provider: string }>(
      `SELECT auth_provider FROM auth_admins ORDER BY created_at ASC LIMIT 1`
    );
    const fromAdmin = r.rows[0]?.auth_provider?.trim().toLowerCase();
    if (fromAdmin && fromAdmin !== 'password') {
      ids.add(fromAdmin);
    }
  } catch {
    // auth_admins may not exist yet
  }
  return ids;
}

/** Single round-trip for setup provider list endpoints. */
export async function loadAdminProviderContext(setup: SetupConfig): Promise<{
  adminAuthProvider: string | null;
  adminOnlyProviderIds: Set<string>;
}> {
  const pool = getSetupPool(setup.databaseUrl);
  const adminOnlyProviderIds = new Set<string>();
  let adminAuthProvider: string | null = null;

  try {
    const [adminRow, cfgRows] = await Promise.all([
      pool.query<{ auth_provider: string }>(
        `SELECT auth_provider FROM auth_admins ORDER BY created_at ASC LIMIT 1`
      ),
      pool.query<{ provider: string }>(
        `SELECT provider FROM auth_admin_oauth_config WHERE company_id=$1`,
        [setup.companyId]
      ),
    ]);

    const fromAdmin = adminRow.rows[0]?.auth_provider?.trim().toLowerCase();
    if (fromAdmin && fromAdmin !== 'password') {
      adminAuthProvider = fromAdmin;
      adminOnlyProviderIds.add(fromAdmin);
    }

    for (const row of cfgRows.rows) {
      adminOnlyProviderIds.add(String(row.provider).toLowerCase());
    }
  } catch {
    // tables may not exist during early setup
  }

  if (!adminAuthProvider) {
    adminAuthProvider = await resolveAdminAuthProviderId(setup.databaseUrl, setup.companyId);
    if (adminAuthProvider) adminOnlyProviderIds.add(adminAuthProvider);
  }

  return { adminAuthProvider, adminOnlyProviderIds };
}

/** Admin OAuth provider id from auth_admins or auth_admin_oauth_config (not product tables). */
export async function resolveAdminAuthProviderId(
  databaseUrl: string,
  companyId?: string
): Promise<string | null> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const r = await pool.query<{ auth_provider: string }>(
      `SELECT auth_provider FROM auth_admins ORDER BY created_at ASC LIMIT 1`
    );
    const fromAdmin = r.rows[0]?.auth_provider?.trim().toLowerCase();
    if (fromAdmin && fromAdmin !== 'password') return fromAdmin;
  } catch {
    // ignore
  } finally {
    await pool.end();
  }

  if (companyId) {
    const fromTable = await listAdminOAuthConfigProviders(databaseUrl, companyId);
    if (fromTable[0]) return fromTable[0];
  }

  const stored = await getAuthSetting<{ provider?: string }>(databaseUrl, ADMIN_AUTH_PROVIDER_KEY);
  return stored?.provider?.trim().toLowerCase() || null;
}

export async function deleteAdminOAuthConfig(setup: SetupConfig, provider: string): Promise<void> {
  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    await pool.query(
      `DELETE FROM auth_admin_oauth_config WHERE company_id=$1 AND provider=$2`,
      [setup.companyId, provider.toLowerCase()]
    );
  } finally {
    await pool.end();
  }
}
