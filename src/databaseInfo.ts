import { Pool } from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';

export const DEMO_USER_EMAILS = [
  'admin@attenus.local',
  'ahmed@attenus.local',
  'sara@attenus.local',
  'omar@attenus.local',
] as const;

export function describeDatabaseUrl(databaseUrl: string): { host: string; database: string; label: string } {
  const parsed = parseConnectionString(databaseUrl);
  const host = String(parsed.host || '').trim();
  const database = String(parsed.database || '').trim();
  return { host, database, label: host && database ? `${host}/${database}` : databaseUrl };
}

export async function probeProductUsers(databaseUrl: string): Promise<{
  usersTable: boolean;
  userCount: number;
  demoFound: string[];
  organisationCount: number;
}> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const usersTable = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users' LIMIT 1`
    );
    if (!usersTable.rowCount) {
      return { usersTable: false, userCount: 0, demoFound: [], organisationCount: 0 };
    }

    const count = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users`);
    const demo = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE LOWER(email) = ANY($1::text[]) ORDER BY email`,
      [DEMO_USER_EMAILS.map((e) => e.toLowerCase())]
    );
    const orgs = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM organisations`
    );
    return {
      usersTable: true,
      userCount: Number(count.rows[0]?.count || 0),
      demoFound: demo.rows.map((r) => r.email),
      organisationCount: Number(orgs.rows[0]?.count || 0),
    };
  } catch {
    return { usersTable: false, userCount: 0, demoFound: [], organisationCount: 0 };
  } finally {
    await pool.end();
  }
}

export function deploymentDatabaseWarning(
  databaseUrl: string,
  probe: Awaited<ReturnType<typeof probeProductUsers>>
): string | null {
  const { label, database } = describeDatabaseUrl(databaseUrl);
  const expectedDb = process.env.EXPECTED_PRODUCT_DATABASE?.trim() || 'erp';

  if (!probe.usersTable) {
    return `Database "${label}" has no users table. Run backend migrations first.`;
  }
  if (probe.demoFound.length === 0) {
    const dbHint =
      database && database !== expectedDb
        ? ` You are on database "${database}" — backend seed uses "${expectedDb}".`
        : '';
    return (
      `Database "${label}" has ${probe.userCount} user(s) but no demo accounts ` +
      `(admin@attenus.local, etc.).${dbHint} ` +
      `Use the same DATABASE_URL as backend/.env and run: cd backend && npm run seed`
    );
  }
  return null;
}
