import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { config } from './config';

/** Stable path regardless of process cwd (e.g. started from monorepo root). */
const runtimeDir = path.resolve(__dirname, '..', '.runtime');
const resumeFile = path.join(runtimeDir, 'setup-resume.json');

export type SetupResumeFile = {
  passwordHash: string;
  salt: string;
  createdAt: string;
};

/** `clientHashedPassword` = SHA-256(plain password) from setup UI (64-char hex). */
function hashClientPassword(clientHashedPassword: string, salt: string): string {
  const derived = crypto.scryptSync(`${clientHashedPassword}${config.setupResumePepper}`, salt, 64);
  return derived.toString('hex');
}

export async function isSetupResumePasswordConfigured(): Promise<boolean> {
  try {
    await fs.access(resumeFile);
    return true;
  } catch {
    return false;
  }
}

export async function createSetupResumePassword(clientHashedPassword: string): Promise<void> {
  if (await isSetupResumePasswordConfigured()) {
    throw new Error('A temporary setup password is already configured');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashClientPassword(clientHashedPassword, salt);
  await fs.mkdir(runtimeDir, { recursive: true });
  const payload: SetupResumeFile = {
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(resumeFile, JSON.stringify(payload, null, 2), 'utf8');
}

export async function verifySetupResumePassword(clientHashedPassword: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(resumeFile, 'utf8');
  } catch {
    return false;
  }
  const stored = JSON.parse(raw) as SetupResumeFile;
  const candidate = hashClientPassword(clientHashedPassword, stored.salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(stored.passwordHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function clearSetupResumePassword(): Promise<void> {
  try {
    await fs.unlink(resumeFile);
  } catch {
    // already removed
  }
}
