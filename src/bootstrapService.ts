import { countAdmins } from './bootstrapDb';
import { getAdminLoginMethod } from './setupAdminAuth';
import { getSetupResumeStatus } from './setupResumeAuth';
import { loadSetupConfigHydrated, type BootstrapPhase } from './setupStore';

export type BootstrapStatus = {
  phase: BootstrapPhase;
  dbConnected: boolean;
  hasAdmin: boolean;
  setupComplete: boolean;
  dbMode: 'product' | 'auth_only' | null;
  companyId: string | null;
  adminLoginMethod: { provider: string; label: string; type: 'password' | 'oauth' } | null;
  resumePasswordConfigured: boolean;
  resumeRequired: boolean;
  /** True when Authorization Bearer is a valid setup-resume session JWT. */
  resumeSessionValid?: boolean;
};

export async function getBootstrapStatus(): Promise<BootstrapStatus> {
  const resume = await getSetupResumeStatus();
  const setup = await loadSetupConfigHydrated();
  if (!setup) {
    return {
      phase: 'connection',
      dbConnected: false,
      hasAdmin: false,
      setupComplete: false,
      dbMode: null,
      companyId: null,
      adminLoginMethod: null,
      resumePasswordConfigured: resume.resumePasswordConfigured,
      resumeRequired: resume.resumeRequired,
    };
  }

  let hasAdmin = false;
  let adminLoginMethod = null as BootstrapStatus['adminLoginMethod'];
  try {
    hasAdmin = (await countAdmins(setup.databaseUrl)) > 0;
    if (hasAdmin) {
      adminLoginMethod = await getAdminLoginMethod(setup.databaseUrl);
    }
  } catch {
    hasAdmin = false;
  }

  let phase = setup.bootstrapPhase;
  if (phase === 'connection' && setup.databaseUrl) {
    phase = hasAdmin ? 'setup' : 'register';
  }
  if (!hasAdmin && phase !== 'connection' && phase !== 'register') {
    phase = 'register';
  }

  return {
    phase,
    dbConnected: true,
    hasAdmin,
    setupComplete: setup.bootstrapPhase === 'complete',
    dbMode: setup.dbMode,
    companyId: setup.companyId,
    adminLoginMethod,
    resumePasswordConfigured: resume.resumePasswordConfigured,
    resumeRequired: resume.resumeRequired,
  };
}
