import { getAdminToken } from './authSession';

const RESUME_TOKEN_KEY = 'auth_setup_resume_token';

export function getResumeToken(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage.getItem(RESUME_TOKEN_KEY);
}

export function setResumeToken(token: string): void {
  sessionStorage.setItem(RESUME_TOKEN_KEY, token);
}

export function clearResumeSession(): void {
  sessionStorage.removeItem(RESUME_TOKEN_KEY);
}

/** Resume session during bootstrap; admin token after admin sign-in. */
export function setupRequestHeaders(): HeadersInit {
  const resume = getResumeToken();
  if (resume) {
    return { Authorization: `Bearer ${resume}` };
  }
  const admin = getAdminToken();
  if (admin) {
    return { Authorization: `Bearer ${admin}` };
  }
  return {};
}

export const SETUP_RESUME_REQUIRED_CODE = 'SETUP_RESUME_REQUIRED';
