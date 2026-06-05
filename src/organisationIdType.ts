import { Pool } from 'pg';

export type OrganisationIdPgType = 'UUID' | 'TEXT';

/** @deprecated Use OrganisationIdPgType */
export type CompanyIdPgType = OrganisationIdPgType;

async function tableExists(pool: Pool, tableName: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1 LIMIT 1`,
    [tableName]
  );
  return Boolean(r.rowCount);
}

export async function getOrganisationsIdPgType(pool: Pool): Promise<OrganisationIdPgType | null> {
  for (const tableName of ['organisations', 'companies']) {
    const r = await pool.query<{ udt_name: string; data_type: string }>(
      `SELECT udt_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'
       LIMIT 1`,
      [tableName]
    );
    const row = r.rows[0];
    if (!row) continue;
    const udt = String(row.udt_name || '').toLowerCase();
    if (udt === 'uuid') return 'UUID';
    return 'TEXT';
  }
  return null;
}

/** @deprecated Use getOrganisationsIdPgType */
export const getCompaniesIdPgType = getOrganisationsIdPgType;

/** Ensure `organisations` exists; return SQL type for `company_id` FK columns. */
export async function ensureOrganisationsTable(pool: Pool): Promise<OrganisationIdPgType> {
  if (await tableExists(pool, 'organisations')) {
    return (await getOrganisationsIdPgType(pool)) ?? 'UUID';
  }

  if (await tableExists(pool, 'companies')) {
    await pool.query(`ALTER TABLE companies RENAME TO organisations`);
    return (await getOrganisationsIdPgType(pool)) ?? 'UUID';
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organisations (
      id UUID PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  return 'UUID';
}

/** @deprecated Use ensureOrganisationsTable */
export const ensureCompaniesTable = ensureOrganisationsTable;
