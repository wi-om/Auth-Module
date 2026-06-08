import fs from 'fs/promises';
import path from 'path';
import { getAuthSetting, setAuthSetting } from './bootstrapDb';
import { config } from './config';

export type BootstrapPhase = 'connection' | 'register' | 'setup' | 'complete';

export type DbMode = 'product' | 'auth_only';

export type SetupConfig = {
  databaseUrl: string;
  dbMode: DbMode;
  companyId: string;
  bootstrapPhase: BootstrapPhase;
  setupCompletedAt?: string;
};

const runtimeDir = path.resolve(__dirname, '..', '.runtime');
const setupFile = path.join(runtimeDir, 'setup.json');

export async function readSetupConfig(): Promise<SetupConfig | null> {
  try {
    const raw = await fs.readFile(setupFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SetupConfig>;
    if (!parsed.databaseUrl || !parsed.companyId) return null;
    return {
      databaseUrl: parsed.databaseUrl,
      companyId: parsed.companyId,
      dbMode: parsed.dbMode === 'auth_only' ? 'auth_only' : 'product',
      bootstrapPhase: parsed.bootstrapPhase || 'complete',
      setupCompletedAt: parsed.setupCompletedAt,
    };
  } catch {
    return null;
  }
}

export async function writeSetupConfig(config: SetupConfig): Promise<void> {
  await fs.mkdir(runtimeDir, { recursive: true });
  await fs.writeFile(setupFile, JSON.stringify(config, null, 2), 'utf8');
  try {
    await setAuthSetting(config.databaseUrl, 'bootstrap', {
      phase: config.bootstrapPhase,
      dbMode: config.dbMode,
      companyId: config.companyId,
      setupCompletedAt: config.setupCompletedAt,
    });
  } catch {
    // DB may not be reachable yet during very first write
  }
}

export async function syncPhaseFromDb(config: SetupConfig): Promise<SetupConfig> {
  const stored = await getAuthSetting<{
    phase?: BootstrapPhase;
    setupCompletedAt?: string;
  }>(config.databaseUrl, 'bootstrap');
  if (!stored?.phase) return config;
  return {
    ...config,
    bootstrapPhase: stored.phase,
    setupCompletedAt: stored.setupCompletedAt ?? config.setupCompletedAt,
  };
}

/** Hydrate setup.json from Azure env or DB when the runtime file was wiped on redeploy. */
export async function ensureSetupFromEnv(): Promise<SetupConfig | null> {
  const existing = await readSetupConfig();
  if (existing) return existing;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return null;

  const companyIdFromEnv = (
    config.productCompanyId ||
    process.env.DEFAULT_COMPANY_ID ||
    '00000000-0000-4000-8000-000000000001'
  ).trim();

  try {
    const stored = await getAuthSetting<{
      phase?: BootstrapPhase;
      dbMode?: DbMode;
      companyId?: string;
      setupCompletedAt?: string;
    }>(databaseUrl, 'bootstrap');
    if (stored?.companyId) {
      const restored: SetupConfig = {
        databaseUrl,
        companyId: stored.companyId,
        dbMode: stored.dbMode === 'auth_only' ? 'auth_only' : 'product',
        bootstrapPhase: stored.phase || 'complete',
        setupCompletedAt: stored.setupCompletedAt,
      };
      await writeSetupConfig(restored);
      return restored;
    }
  } catch {
    // DB unreachable — fall through to env-only bootstrap
  }

  const bootstrapped: SetupConfig = {
    databaseUrl,
    companyId: companyIdFromEnv,
    dbMode: 'product',
    bootstrapPhase: 'register',
  };
  await writeSetupConfig(bootstrapped);
  return bootstrapped;
}

export async function loadSetupConfigHydrated(): Promise<SetupConfig | null> {
  await ensureSetupFromEnv();
  const file = await readSetupConfig();
  if (!file) return null;
  try {
    return await syncPhaseFromDb(file);
  } catch {
    return file;
  }
}
