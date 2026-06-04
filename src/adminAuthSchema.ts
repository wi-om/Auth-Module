import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { ensureAdminOAuthConfigTable } from './adminOAuthConfig';

export async function ensureAdminAuthSchema(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const filePath = path.resolve(__dirname, '../scripts/migrations/002-admin-auth-columns.sql');
    const sql = fs.readFileSync(filePath, 'utf8');
    await pool.query(sql);
    await ensureAdminOAuthConfigTable(databaseUrl);
  } finally {
    await pool.end();
  }
}
