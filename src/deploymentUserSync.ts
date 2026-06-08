import { Pool } from 'pg';
import { config } from './config';
import { resolveProductCompanyId } from './bootstrapDb';
import {
  DEMO_USER_EMAILS,
  deploymentDatabaseWarning,
  describeDatabaseUrl,
  probeProductUsers,
} from './databaseInfo';
import { logLoginDebug, pepperFingerprint } from './loginDebug';
import { hashPlainPasswordForUser } from './productPassword';
import { readSetupConfig, writeSetupConfig, type SetupConfig } from './setupStore';

/** @deprecated Use DEMO_USER_EMAILS from databaseInfo */
export const DEPLOYMENT_DEMO_EMAILS = DEMO_USER_EMAILS;

export type DeploymentUserSyncResult = {
  companyId: string;
  synced: string[];
  skipped: string[];
  demoPassword: string;
  database: string;
  userCount: number;
  demoFound: string[];
  warning: string | null;
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
  const database = describeDatabaseUrl(databaseUrl);
  const probe = await probeProductUsers(databaseUrl);
  let companyId = await resolveProductCompanyId(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl });
  const synced: string[] = [];
  const skipped: string[] = [];

  try {
    if (!probe.usersTable) {
      const warning = deploymentDatabaseWarning(databaseUrl, probe);
      logLoginDebug('deployment_user_sync', {
        database: database.label,
        companyId,
        synced,
        skipped: [...DEMO_USER_EMAILS],
        userCount: 0,
        warning,
        pepper: pepperFingerprint(pepper),
      });
      return {
        companyId,
        synced,
        skipped: [...DEMO_USER_EMAILS],
        demoPassword: plainPassword,
        database: database.label,
        userCount: 0,
        demoFound: [],
        warning,
      };
    }

    for (const email of DEMO_USER_EMAILS) {
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
      if (user.company_id) {
        companyId = user.company_id;
      }
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

    const warning = deploymentDatabaseWarning(databaseUrl, {
      ...probe,
      demoFound: probe.demoFound.length ? probe.demoFound : synced,
    });

    logLoginDebug('deployment_user_sync', {
      database: database.label,
      companyId,
      synced,
      skipped,
      userCount: probe.userCount,
      demoFound: probe.demoFound,
      warning,
      pepper: pepperFingerprint(pepper),
      hashExamplePrefix: synced.length
        ? hashPlainPasswordForUser(plainPassword, '00000000-0000-4000-8000-000000000001', pepper).slice(0, 12)
        : null,
    });

    return {
      companyId,
      synced,
      skipped,
      demoPassword: plainPassword,
      database: database.label,
      userCount: probe.userCount,
      demoFound: probe.demoFound,
      warning,
    };
  } finally {
    await pool.end();
  }
}
