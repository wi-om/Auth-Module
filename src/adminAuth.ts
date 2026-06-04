import crypto from 'crypto';
import { Pool } from 'pg';
import { config } from './config';
import { compareClientHashedPassword, hashClientHashedPassword } from './productPassword';
import { issueProductSessionToken } from './productJwt';
import { countAdmins, setAuthSetting } from './bootstrapDb';
import { loadSetupConfigHydrated, type SetupConfig } from './setupStore';
import { ensureAdminAuthSchema } from './adminAuthSchema';
import { clearSetupResumeAfterAdminCreated } from './setupResumeAuth';

export type AdminRow = {
  id: string;
  email: string;
  password_hash: string | null;
  auth_provider?: string;
  oauth_subject?: string | null;
};

async function requireDbSetup(): Promise<SetupConfig> {
  const setup = await loadSetupConfigHydrated();
  if (!setup?.databaseUrl) {
    throw new Error('Database connection is not configured');
  }
  return setup;
}

export async function registerAdmin(
  email: string,
  clientHashedPassword: string
): Promise<{ admin: AdminRow; accessToken: string }> {
  const setup = await requireDbSetup();
  const adminCount = await countAdmins(setup.databaseUrl);
  if (adminCount > 0) {
    throw new Error('An admin account already exists');
  }

  await ensureAdminAuthSchema(setup.databaseUrl);
  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    const existing = await pool.query(`SELECT 1 FROM auth_admins WHERE LOWER(email) = LOWER($1) LIMIT 1`, [
      email.trim(),
    ]);
    if (existing.rowCount) {
      throw new Error('Email already registered');
    }

    const adminId = crypto.randomUUID();
    const passwordHash = hashClientHashedPassword(
      clientHashedPassword,
      adminId,
      config.adminPepper
    );

    const insert = await pool.query<AdminRow>(
      `INSERT INTO auth_admins (id, email, password_hash, auth_provider) VALUES ($1, $2, $3, 'password')
       RETURNING id, email, password_hash`,
      [adminId, email.trim().toLowerCase(), passwordHash]
    );
    const admin = insert.rows[0];
    await setAuthSetting(setup.databaseUrl, 'admin_auth_provider', { provider: 'password' });
    await clearSetupResumeAfterAdminCreated();

    const accessToken = issueAdminToken(admin, setup);

    return { admin, accessToken };
  } finally {
    await pool.end();
  }
}

export async function loginAdmin(
  email: string,
  clientHashedPassword: string
): Promise<{ admin: AdminRow; accessToken: string }> {
  const setup = await requireDbSetup();
  await ensureAdminAuthSchema(setup.databaseUrl);
  const pool = new Pool({ connectionString: setup.databaseUrl });
  try {
    const result = await pool.query<AdminRow>(
      `SELECT id, email, password_hash, auth_provider FROM auth_admins WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email.trim()]
    );
    const admin = result.rows[0];
    if (!admin) {
      throw new Error('Invalid credentials');
    }
    if (admin.auth_provider && admin.auth_provider !== 'password') {
      throw new Error(`Use ${admin.auth_provider} to sign in`);
    }
    if (!admin.password_hash) {
      throw new Error('Invalid credentials');
    }
    const valid = compareClientHashedPassword(
      clientHashedPassword,
      admin.id,
      admin.password_hash,
      config.adminPepper
    );
    if (!valid) {
      throw new Error('Invalid credentials');
    }
    return { admin, accessToken: issueAdminToken(admin, setup) };
  } finally {
    await pool.end();
  }
}

export function issueAdminToken(admin: { id: string; email: string }, setup: SetupConfig): string {
  return issueProductSessionToken(
    {
      userId: admin.id,
      companyId: setup.companyId,
      email: admin.email,
      role: 'auth_admin',
    },
    config.jwtSecretForProduct,
    parseJwtTtl(config.productJwtExpiresIn)
  );
}

function parseJwtTtl(value: string): number {
  const match = /^(\d+)([smhd])$/i.exec(value.trim());
  if (!match) return 7 * 24 * 60 * 60;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 's') return n;
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 60 * 60;
  return n * 24 * 60 * 60;
}

export async function findAdminById(databaseUrl: string, id: string): Promise<AdminRow | null> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const r = await pool.query<AdminRow>(
      `SELECT id, email, password_hash FROM auth_admins WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  } finally {
    await pool.end();
  }
}
