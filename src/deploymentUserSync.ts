import { Pool } from 'pg';
import { config } from './config';
import { resolveProductCompanyId } from './bootstrapDb';
import { hashPlainPasswordForUser } from './productPassword';
import { readSetupConfig, writeSetupConfig, type SetupConfig } from './setupStore';

/** Demo accounts from backend seed — re-hashed on setup connect so Azure pepper always matches. */
export const DEPLOYMENT_DEMO_EMAILS = [
  'admin@attenus.local',
  'ahmed@attenus.local',
  'sara@attenus.local',
  'omar@attenus.local',
] as const;

export type DeploymentUserSyncResult = {
  companyId: string;
  synced: string[];
  skipped: string[];
  demoPassword: string;
};

function demoPlainPassword(): string {
  return process.env.SETUP_DEMO_PASSWORD?.trim() || 'password123';
}

/** Align setup.json companyId + demo user password hashes with this service's AUTH_USER_PEPPER. */
export async function syncDeploymentDemoUsers(
  databaseUrl: string,
  options?: { plainPassword?: string; dbMode?: SetupConfig['dbMode'] }
): Promise<DeploymentUserSyncResult | null> {
  if (options?.dbMode === 'auth_only') {
    return null;
  }

  const plainPassword = options?.plainPassword?.trim() || demoPlainPassword();
  const pepper = config.userPepper;
  const companyId = await resolveProductCompanyId(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  const synced: string[] = [];
  const skipped: string[] = [];

  try {
    const usersTable = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users' LIMIT 1`
    );
    if (!usersTable.rowCount) {
      return { companyId, synced, skipped: [...DEPLOYMENT_DEMO_EMAILS], demoPassword: plainPassword };
    }

    for (const email of DEPLOYMENT_DEMO_EMAILS) {
      const row = await pool.query<{ id: string; company_id: string }>(
        `SELECT id::text AS id, company_id::text AS company_id
         FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email]
      );
      const user = row.rows[0];
      if (!user?.id) {
        skipped.push(email);
        continue;
      }

      const storedHash = hashPlainPasswordForUser(plainPassword, user.id, pepper);
      await pool.query(
        `UPDATE users SET password = $1, is_active = TRUE WHERE id::text = $2`,
        [storedHash, user.id]
      );
      synced.push(email);
    }

    const existing = await readSetupConfig();
    const dbMode: SetupConfig['dbMode'] = existing?.dbMode ?? options?.dbMode ?? 'product';
    await writeSetupConfig({
      databaseUrl,
      companyId,
      dbMode,
      bootstrapPhase: existing?.bootstrapPhase ?? 'register',
      setupCompletedAt: existing?.setupCompletedAt,
    });

    return { companyId, synced, skipped, demoPassword: plainPassword };
  } finally {
    await pool.end();
  }
}
