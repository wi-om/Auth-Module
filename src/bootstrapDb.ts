import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';
import { ensureCompaniesTable } from './companyIdType';
import { ensureAdminAuthSchema } from './adminAuthSchema';
import { ensureAuthSetupTables } from './productDbConfig';

export type DbMode = 'product' | 'auth_only';

export type ConnectionInput = {
  databaseUrl?: string;
  host?: string;
  port?: string | number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
};

const REQUIRED_AUTH_TABLES = ['auth_settings', 'auth_admins', 'auth_provider_plugins', 'auth_provider_settings'];
const PRODUCT_EXTRA_TABLES = ['companies'];

const PLACEHOLDER_HOSTS = new Set(['base', 'host', 'localhost', 'dbname']);

/** Reject malformed URLs before pg falls back to dummy host "base" (ENOTFOUND base). */
export function validateConnectionString(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error('Database connection URL is empty');
  }
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
    throw new Error(
      'Use a full postgresql:// URL (Connection URL tab), or fill server, user, and database fields'
    );
  }

  let config: ReturnType<typeof parseConnectionString>;
  try {
    config = parseConnectionString(trimmed);
  } catch {
    throw new Error(
      'Invalid PostgreSQL URL. Encode @ in the password as %40 (example: Delta%4022, not Delta@22)'
    );
  }

  const host = String(config.host || '').trim();
  if (!host || PLACEHOLDER_HOSTS.has(host.toLowerCase())) {
    throw new Error(
      'Could not read a valid database host. Paste the full Azure URL and encode @ in the password as %40'
    );
  }
  if (!config.database) {
    throw new Error('Database name missing from URL (path should end with /erp or your DB name)');
  }

  return trimmed;
}

export function buildDatabaseUrl(input: ConnectionInput): string {
  if (input.databaseUrl?.trim()) {
    return validateConnectionString(input.databaseUrl);
  }
  const host = String(input.host || '').trim();
  const user = String(input.user || '').trim();
  const database = String(input.database || '').trim();
  if (!host || !user || !database) {
    throw new Error('Provide databaseUrl or host, user, and database name');
  }
  if (PLACEHOLDER_HOSTS.has(host.toLowerCase())) {
    throw new Error('Replace placeholder host with your server (e.g. po-dev.postgres.database.azure.com)');
  }
  const port = input.port ? String(input.port) : '5432';
  const password = input.password !== undefined ? String(input.password) : '';
  const encodedUser = encodeURIComponent(user);
  const encodedPass = encodeURIComponent(password);
  const auth = password ? `${encodedUser}:${encodedPass}` : encodedUser;
  const built = `postgresql://${auth}@${host}:${port}/${database}`;
  return validateConnectionString(input.ssl ? `${built}?sslmode=require` : built);
}

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return Boolean(r.rowCount);
}

export async function probeSchema(
  databaseUrl: string,
  dbMode: DbMode
): Promise<{ tablesExist: boolean; missingTables: string[]; warnings: string[] }> {
  const pool = new Pool({ connectionString: databaseUrl });
  const required = [...REQUIRED_AUTH_TABLES, ...(dbMode === 'product' ? PRODUCT_EXTRA_TABLES : ['companies'])];
  const missingTables: string[] = [];
  const warnings: string[] = [];

  try {
    await pool.query('SELECT 1');
    for (const t of required) {
      if (!(await tableExists(pool, t))) {
        missingTables.push(t);
      }
    }
    if (dbMode === 'product' && (await tableExists(pool, 'companies')) && !(await tableExists(pool, 'users'))) {
      warnings.push('users table not found — product app may create it later');
    }
  } finally {
    await pool.end();
  }

  return { tablesExist: missingTables.length === 0, missingTables, warnings };
}

async function runSqlFile(pool: Pool, filename: string): Promise<void> {
  const filePath = path.resolve(__dirname, '../scripts/migrations', filename);
  const sql = fs.readFileSync(filePath, 'utf8');
  await pool.query(sql);
}

export async function runBootstrapMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await runSqlFile(pool, '001-auth-bootstrap.sql');
    for (const file of ['003-auth-admin-oauth-config.sql', '004-separate-admin-product-auth.sql']) {
      try {
        await runSqlFile(pool, file);
      } catch {
        // optional migrations (may already be applied at runtime)
      }
    }
  } finally {
    await pool.end();
  }
}

export async function ensureDefaultCompany(databaseUrl: string): Promise<string> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await ensureCompaniesTable(pool);
    const existing = await pool.query<{ id: string }>(`SELECT id FROM companies LIMIT 1`);
    if (existing.rows[0]?.id) {
      return String(existing.rows[0].id);
    }
    const companyId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO companies (id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
      [companyId, 'Default']
    );
    return companyId;
  } finally {
    await pool.end();
  }
}

export async function getAuthSetting<T>(databaseUrl: string, key: string): Promise<T | null> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const r = await pool.query<{ value: T }>(
      `SELECT value FROM auth_settings WHERE key = $1 LIMIT 1`,
      [key]
    );
    return r.rows[0]?.value ?? null;
  } catch {
    return null;
  } finally {
    await pool.end();
  }
}

export async function setAuthSetting(databaseUrl: string, key: string, value: unknown): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(
      `INSERT INTO auth_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
  } finally {
    await pool.end();
  }
}

export async function deleteAuthSetting(databaseUrl: string, key: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`DELETE FROM auth_settings WHERE key = $1`, [key]);
  } finally {
    await pool.end();
  }
}

export async function countAdmins(databaseUrl: string): Promise<number> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const r = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM auth_admins`);
    return Number(r.rows[0]?.count || 0);
  } catch {
    return 0;
  } finally {
    await pool.end();
  }
}

export async function testAndPrepareConnection(
  input: ConnectionInput,
  dbMode: DbMode,
  options?: { migrate?: boolean }
): Promise<{
  databaseUrl: string;
  companyId: string;
  tablesExist: boolean;
  missingTables: string[];
  warnings: string[];
  migrated: boolean;
}> {
  const databaseUrl = buildDatabaseUrl(input);
  let probe = await probeSchema(databaseUrl, dbMode);
  let migrated = false;

  if (!probe.tablesExist && options?.migrate !== false) {
    await runBootstrapMigration(databaseUrl);
    migrated = true;
  }

  // companies + auth_provider_* are created here (not in 001-auth-bootstrap.sql)
  const companyId = await ensureDefaultCompany(databaseUrl);
  await ensureAdminAuthSchema(databaseUrl);
  await ensureAuthSetupTables(databaseUrl, companyId);

  probe = await probeSchema(databaseUrl, dbMode);
  if (!probe.tablesExist) {
    throw new Error(
      `Schema setup finished but tables still missing: ${probe.missingTables.join(', ')}`
    );
  }

  await setAuthSetting(databaseUrl, 'db_mode', dbMode);

  return {
    databaseUrl,
    companyId,
    tablesExist: probe.tablesExist,
    missingTables: probe.missingTables,
    warnings: probe.warnings,
    migrated,
  };
}
