import { Pool } from 'pg';

export type CompanyIdPgType = 'UUID' | 'TEXT';

export async function getCompaniesIdPgType(pool: Pool): Promise<CompanyIdPgType | null> {
  const r = await pool.query<{ udt_name: string; data_type: string }>(
    `SELECT udt_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'id'
     LIMIT 1`
  );
  const row = r.rows[0];
  if (!row) return null;
  const udt = String(row.udt_name || '').toLowerCase();
  if (udt === 'uuid') return 'UUID';
  return 'TEXT';
}

/** Ensure `companies` exists; return the SQL type to use for `company_id` FK columns. */
export async function ensureCompaniesTable(pool: Pool): Promise<CompanyIdPgType> {
  const existing = await getCompaniesIdPgType(pool);
  if (existing) return existing;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id UUID PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  return 'UUID';
}
