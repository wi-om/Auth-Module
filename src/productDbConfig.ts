import { Pool } from 'pg';
import type { ProviderPluginManifest } from './plugin/manifestSchema';
import { ensureAdminOAuthConfigTable } from './adminOAuthConfig';
import { ensureOrganisationsTable, type OrganisationIdPgType } from './organisationIdType';

type ProductProviderRow = {
  provider: string;
  enabled: boolean;
  client_id: string;
  client_secret: string;
  extra_config: Record<string, string>;
};

type ProductPluginRow = {
  id: string;
  label: string;
  version: string;
  plugin_type: 'oauth' | 'passkey';
  manifest: ProviderPluginManifest;
  source_filename: string;
  source_checksum: string;
  created_at?: string | Date;
  updated_at?: string | Date;
};

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return Boolean(r.rowCount);
}

async function authProviderSchemaExists(pool: Pool): Promise<boolean> {
  return (
    (await tableExists(pool, 'auth_provider_plugins')) ||
    (await tableExists(pool, 'auth_provider_settings'))
  );
}

const authTablesEnsuredKeys = new Set<string>();

export function invalidateAuthSetupTablesCache(databaseUrl: string): void {
  authTablesEnsuredKeys.delete(databaseUrl);
}

export async function ensureAuthSetupTables(databaseUrl: string, companyId?: string): Promise<void> {
  if (authTablesEnsuredKeys.has(databaseUrl)) return;

  const { getSetupPool } = await import('./setupDbPool');
  const pool = getSetupPool(databaseUrl);
  await ensureAdminOAuthConfigTable(databaseUrl);
  const companyIdType = await ensureOrganisationsTable(pool);

  if (!(await authProviderSchemaExists(pool))) {
    await createAuthProviderTables(pool, companyIdType);
  } else if (await authTablesCompanyIdTypeMismatch(pool, companyIdType)) {
    await repairAuthProviderCompanyIdType(pool, companyIdType, companyId);
  } else {
    await upgradeAuthProviderTables(pool, companyId, companyIdType);
  }

  authTablesEnsuredKeys.add(databaseUrl);
}

async function getTableOrganisationIdPgType(pool: Pool, table: string): Promise<OrganisationIdPgType | null> {
  const r = await pool.query<{ udt_name: string }>(
    `SELECT udt_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'company_id' LIMIT 1`,
    [table]
  );
  const col = r.rows[0];
  if (!col) return null;
  const udt = String(col.udt_name || '').toLowerCase();
  return udt === 'uuid' ? 'UUID' : 'TEXT';
}

async function authTablesCompanyIdTypeMismatch(pool: Pool, expected: OrganisationIdPgType): Promise<boolean> {
  for (const table of ['auth_provider_plugins', 'auth_provider_settings'] as const) {
    const actual = await getTableOrganisationIdPgType(pool, table);
    if (actual && actual !== expected) return true;
  }
  return false;
}

async function dropAuthProviderTables(pool: Pool): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS auth_provider_settings CASCADE`);
  await pool.query(`DROP TABLE IF EXISTS auth_provider_plugins CASCADE`);
}

async function dropTableCompanyFks(pool: Pool, tableName: string): Promise<void> {
  const fks = await pool.query<{ conname: string }>(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_class ref ON ref.oid = c.confrelid
     WHERE t.relname = $1 AND ref.relname = 'organisations' AND c.contype = 'f'`,
    [tableName]
  );
  for (const row of fks.rows) {
    await pool.query(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS "${row.conname}"`);
  }
}

async function dropTablePrimaryKey(pool: Pool, tableName: string): Promise<void> {
  const pks = await pool.query<{ conname: string }>(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = $1 AND c.contype = 'p'`,
    [tableName]
  );
  for (const row of pks.rows) {
    await pool.query(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS "${row.conname}"`);
  }
}

async function realignAuthProviderCompanyIds(pool: Pool, companyId?: string): Promise<void> {
  for (const table of ['auth_provider_settings', 'auth_provider_plugins'] as const) {
    if (!(await tableExists(pool, table))) continue;

    if (companyId) {
      await pool.query(
        `UPDATE ${table} AS t
         SET company_id = $1
         WHERE company_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM organisations c WHERE c.id = t.company_id)`,
        [companyId]
      );
    } else {
      await pool.query(
        `DELETE FROM ${table} AS t
         WHERE company_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM organisations c WHERE c.id = t.company_id)`
      );
    }
  }
}

async function migrateAuthTableCompanyId(
  pool: Pool,
  tableName: string,
  from: OrganisationIdPgType,
  to: OrganisationIdPgType
): Promise<void> {
  if (from === to) return;

  await dropTableCompanyFks(pool, tableName);
  await dropTablePrimaryKey(pool, tableName);

  const usingExpr = to === 'TEXT' ? 'company_id::text' : 'company_id::uuid';
  await pool.query(`ALTER TABLE ${tableName} ALTER COLUMN company_id TYPE ${to} USING ${usingExpr}`);
}

/** Fix UUID/TEXT mismatch from an earlier bootstrap (with or without existing rows). */
async function repairAuthProviderCompanyIdType(
  pool: Pool,
  expected: OrganisationIdPgType,
  companyId?: string
): Promise<void> {
  console.warn(`[auth] Aligning auth_provider_* company_id to ${expected} (organisations.id).`);

  try {
    for (const table of ['auth_provider_settings', 'auth_provider_plugins'] as const) {
      if (!(await tableExists(pool, table))) continue;
      const actual = await getTableOrganisationIdPgType(pool, table);
      if (!actual || actual === expected) continue;
      await migrateAuthTableCompanyId(pool, table, actual, expected);
    }

    await realignAuthProviderCompanyIds(pool, companyId);
    await upgradeAuthProviderTables(pool, companyId, expected);
  } catch (err) {
    console.warn('[auth] In-place company_id migration failed; recreating auth_provider_* tables.', err);
    await dropAuthProviderTables(pool);
    await createAuthProviderTables(pool, expected);
    if (companyId) {
      await pool.query(
        `INSERT INTO auth_provider_settings (company_id, provider, enabled, client_id, client_secret, extra_config)
         VALUES ($1, 'password', TRUE, '', '', '{}'::jsonb)
         ON CONFLICT (company_id, provider) DO NOTHING`,
        [companyId]
      );
    }
  }
}

async function createAuthProviderTables(pool: Pool, companyIdType: OrganisationIdPgType): Promise<void> {
  const cid = companyIdType;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_provider_plugins (
      company_id ${cid} NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      version TEXT NOT NULL,
      plugin_type TEXT NOT NULL CHECK (plugin_type IN ('oauth', 'passkey')),
      manifest JSONB NOT NULL,
      source_filename TEXT NOT NULL,
      source_checksum TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_provider_settings (
      company_id ${cid} NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      client_id TEXT NOT NULL DEFAULT '',
      client_secret TEXT NOT NULL DEFAULT '',
      extra_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, provider)
    )
  `);
}

async function upgradeAuthProviderTables(
  pool: Pool,
  companyId: string | undefined,
  companyIdType: OrganisationIdPgType
): Promise<void> {
  const cid = companyIdType;

  await pool.query(`
    ALTER TABLE auth_provider_settings
    ADD COLUMN IF NOT EXISTS company_id ${cid}
  `);
  await pool.query(`
    ALTER TABLE auth_provider_plugins
    ADD COLUMN IF NOT EXISTS company_id ${cid}
  `);

  if (companyId) {
    await pool.query(`UPDATE auth_provider_settings SET company_id = $1 WHERE company_id IS NULL`, [companyId]);
    await pool.query(`UPDATE auth_provider_plugins SET company_id = $1 WHERE company_id IS NULL`, [companyId]);
  }

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'auth_provider_settings' AND column_name = 'company_id' AND is_nullable = 'YES'
      ) THEN
        ALTER TABLE auth_provider_settings ALTER COLUMN company_id SET NOT NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'auth_provider_plugins' AND column_name = 'company_id' AND is_nullable = 'YES'
      ) THEN
        ALTER TABLE auth_provider_plugins ALTER COLUMN company_id SET NOT NULL;
      END IF;
    END $$;
  `);

  await pool.query(`ALTER TABLE auth_provider_settings DROP CONSTRAINT IF EXISTS auth_provider_settings_pkey`);
  await pool.query(`ALTER TABLE auth_provider_plugins DROP CONSTRAINT IF EXISTS auth_provider_plugins_pkey`);
  await pool.query(`ALTER TABLE auth_provider_plugins DROP CONSTRAINT IF EXISTS auth_provider_plugins_pkey1`);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auth_provider_settings_pkey'
      ) THEN
        ALTER TABLE auth_provider_settings ADD CONSTRAINT auth_provider_settings_pkey PRIMARY KEY (company_id, provider);
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auth_provider_plugins_pkey'
      ) THEN
        ALTER TABLE auth_provider_plugins ADD CONSTRAINT auth_provider_plugins_pkey PRIMARY KEY (company_id, id);
      END IF;
    END $$;
  `);

  await addCompanyFkIfMissing(pool, 'auth_provider_settings', companyIdType);
  await addCompanyFkIfMissing(pool, 'auth_provider_plugins', companyIdType);
}

async function addCompanyFkIfMissing(
  pool: Pool,
  tableName: string,
  companyIdType: OrganisationIdPgType
): Promise<void> {
  const fkName = `${tableName}_company_id_fkey`;
  const exists = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1`,
    [fkName]
  );
  if (exists.rowCount) return;

  try {
    await pool.query(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${fkName}
      FOREIGN KEY (company_id) REFERENCES organisations(id) ON DELETE CASCADE
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('cannot be implemented') || msg.includes('incompatible types')) {
      throw new Error(
        `${tableName}.company_id type does not match organisations.id (${companyIdType}). ` +
          'Drop legacy auth_provider_* tables or align organisations.id with your product schema.'
      );
    }
    throw err;
  }
}

export async function getBootstrapFromProductDb(databaseUrl: string, companyId: string): Promise<{
  providers: ProductProviderRow[];
  plugins: ProductPluginRow[];
}> {
  const { getSetupPool } = await import('./setupDbPool');
  const pool = getSetupPool(databaseUrl);
  await ensureAuthSetupTables(databaseUrl, companyId);
  await pool.query(
    `
      INSERT INTO auth_provider_settings (company_id, provider, enabled, client_id, client_secret, extra_config)
      VALUES ($1, 'password', TRUE, '', '', '{}'::jsonb)
      ON CONFLICT (company_id, provider) DO NOTHING
    `,
    [companyId]
  );

  const providerRows = await pool.query<ProductProviderRow>(
    `SELECT provider, enabled, client_id, client_secret, extra_config FROM auth_provider_settings WHERE company_id = $1 ORDER BY provider ASC`,
    [companyId]
  );
  const pluginRows = await pool.query<ProductPluginRow>(
    `SELECT id, label, version, plugin_type, manifest, source_filename, source_checksum, created_at, updated_at
     FROM auth_provider_plugins WHERE company_id = $1 ORDER BY label ASC`,
    [companyId]
  );
  return { providers: providerRows.rows, plugins: pluginRows.rows };
}
