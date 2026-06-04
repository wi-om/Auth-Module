import { countAdmins } from './bootstrapDb';
import { issueProductSessionToken, verifyProductSessionToken } from './productJwt';
import { config } from './config';
import { loadSetupConfigHydrated } from './setupStore';
import { assertClientHashedPassword } from './setupResumePassword';
import {
  clearSetupResumePassword,
  createSetupResumePassword,
  isSetupResumePasswordConfigured,
  verifySetupResumePassword,
} from './setupResumeStore';

export const SETUP_RESUME_ROLE = 'setup_resume';

export async function getSetupResumeStatus(): Promise<{
  resumePasswordConfigured: boolean;
  resumeRequired: boolean;
}> {
  const configured = await isSetupResumePasswordConfigured();
  if (!configured) {
    return { resumePasswordConfigured: false, resumeRequired: false };
  }

  let hasAdmin = false;
  const setup = await loadSetupConfigHydrated();
  if (setup?.databaseUrl) {
    try {
      hasAdmin = (await countAdmins(setup.databaseUrl)) > 0;
    } catch {
      hasAdmin = false;
    }
  }

  return {
    resumePasswordConfigured: true,
    resumeRequired: !hasAdmin,
  };
}

/** Saves client-hashed temp password and returns a setup-resume JWT for the current wizard session. */
export async function setupCreateResumePassword(clientHashedPassword: string): Promise<string> {
  const hash = assertClientHashedPassword(clientHashedPassword);
  await createSetupResumePassword(hash);
  return issueSetupResumeSessionToken();
}

export function issueSetupResumeSessionToken(): string {
  return issueProductSessionToken(
    {
      userId: 'setup-resume',
      companyId: 'setup',
      email: 'setup@local',
      role: SETUP_RESUME_ROLE,
    },
    config.jwtSecretForProduct,
    7 * 24 * 60 * 60
  );
}

export function verifySetupResumeSessionToken(token: string): boolean {
  try {
    const claims = verifyProductSessionToken(token, config.jwtSecretForProduct);
    return claims.role === SETUP_RESUME_ROLE;
  } catch {
    return false;
  }
}

export async function setupVerifyResumePassword(clientHashedPassword: string): Promise<string> {
  const hash = assertClientHashedPassword(clientHashedPassword);
  const ok = await verifySetupResumePassword(hash);
  if (!ok) {
    throw new Error('Incorrect temporary setup password');
  }
  return issueSetupResumeSessionToken();
}

/** After admin account exists, temporary resume password is no longer used. */
export async function removeSetupResumeIfAdminReady(): Promise<void> {
  const setup = await loadSetupConfigHydrated();
  if (!setup?.databaseUrl) return;
  try {
    if ((await countAdmins(setup.databaseUrl)) > 0) {
      await clearSetupResumePassword();
    }
  } catch {
    // ignore
  }
}

export async function clearSetupResumeAfterAdminCreated(): Promise<void> {
  await clearSetupResumePassword();
}
