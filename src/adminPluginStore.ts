import crypto from 'crypto';
import { Pool } from 'pg';
import { ensureCompaniesTable, type CompanyIdPgType } from './companyIdType';
import { readExamplePluginManifest, exampleFilenameForPlugin } from './pluginCatalog';
import type { ProviderPluginManifest } from './plugin/manifestSchema';
import { registerPlugin, type PluginRecord } from './plugin/pluginRegistry';
import type { SetupConfig } from './setupStore';

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return Boolean(r.rowCount);
}

/** Admin OAuth plugin manifests — never stored in auth_provider_plugins. */
export async function ensureAdminPluginsTable(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const companyIdType = await ensureCompaniesTable(pool);
    const cid = companyIdType;

    if (!(await tableExists(pool, 'auth_admin_plugins'))) {
      await pool.query(`
        CREATE TABLE auth_admin_plugins (
          company_id ${cid} NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
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
    }
  } finally {
    await pool.end();
  }
}

export async function upsertAdminPluginFromCatalog(
  setup: SetupConfig,
  providerId: string
): Promise<ProviderPluginManifest> {
  const provider = providerId.toLowerCase();
  const manifest = readExamplePluginManifest(provider);
  const checksum = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const sourceFilename = exampleFilenameForPlugin(provider);

  await ensureAdminPluginsTable(setup.databaseUrl);
  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    await pool.query(
      `INSERT INTO auth_admin_plugins (company_id, id, label, version, plugin_type, manifest, source_filename, source_checksum, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,NOW())
       ON CONFLICT (company_id, id)
       DO UPDATE SET label=EXCLUDED.label, version=EXCLUDED.version, plugin_type=EXCLUDED.plugin_type,
         manifest=EXCLUDED.manifest, source_filename=EXCLUDED.source_filename, source_checksum=EXCLUDED.source_checksum,
         updated_at=NOW()`,
      [
        setup.companyId,
        manifest.id,
        manifest.label,
        manifest.version,
        manifest.type,
        JSON.stringify(manifest),
        sourceFilename,
        checksum,
      ]
    );
  } finally {
    await pool.end();
  }

  return manifest;
}

export async function registerAdminPluginInRuntime(
  setup: SetupConfig,
  providerId: string
): Promise<PluginRecord | null> {
  const provider = providerId.toLowerCase();
  await ensureAdminPluginsTable(setup.databaseUrl);
  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    const r = await pool.query<{
      id: string;
      label: string;
      version: string;
      plugin_type: string;
      manifest: ProviderPluginManifest;
      source_filename: string;
      source_checksum: string;
    }>(
      `SELECT id, label, version, plugin_type, manifest, source_filename, source_checksum
       FROM auth_admin_plugins WHERE company_id=$1 AND id=$2 LIMIT 1`,
      [setup.companyId, provider]
    );
    const row = r.rows[0];
    if (row?.manifest) {
      return registerPlugin(row.manifest, row.source_filename, row.source_checksum);
    }
  } catch {
    // fall through to catalog
  } finally {
    await pool.end();
  }

  try {
    const manifest = readExamplePluginManifest(provider);
    const checksum = crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    return registerPlugin(manifest, exampleFilenameForPlugin(provider), checksum);
  } catch {
    return null;
  }
}
