import type {
  AdminAuthOption,
  AdminLoginMethod,
  BootstrapStatus,
  ConnectionPayload,
  ConnectionTestResult,
  PluginCatalogResponse,
  ProvidersResponse,
} from '../types';
import { authHeaders } from '../utils/authSession';
import {
  clearResumeSession,
  setResumeToken,
  setupRequestHeaders,
  SETUP_RESUME_REQUIRED_CODE,
} from '../utils/resumeSession';

const BASE = '/setup/api';

const fetchOpts: RequestInit = { cache: 'no-store' };

function protectedHeaders(extra?: HeadersInit): HeadersInit {
  return { ...setupRequestHeaders(), ...extra };
}

export class SetupResumeRequiredError extends Error {
  code = SETUP_RESUME_REQUIRED_CODE;
  constructor(message: string) {
    super(message);
    this.name = 'SetupResumeRequiredError';
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    throw new Error('Empty response from server — reload the page');
  }
  const data = (await res.json()) as T & { error?: string; code?: string };
  if (!res.ok) {
    if (res.status === 401 && (data as { code?: string }).code === SETUP_RESUME_REQUIRED_CODE) {
      clearResumeSession();
      throw new SetupResumeRequiredError(
        (data as { error?: string }).error || 'Temporary setup password required'
      );
    }
    throw new Error((data as { error?: string }).error || res.statusText);
  }
  return data;
}

export async function fetchBootstrapStatus(): Promise<BootstrapStatus> {
  const res = await fetch(`${BASE}/bootstrap/status`, {
    ...fetchOpts,
    headers: setupRequestHeaders(),
  });
  return parseJson<BootstrapStatus>(res);
}

export async function createResumePassword(body: {
  clientHashedPassword: string;
  clientHashedConfirmPassword: string;
}): Promise<{ message: string; resumeSessionToken: string }> {
  const res = await fetch(`${BASE}/resume/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ message: string; resumeSessionToken: string }>(res);
  if (data.resumeSessionToken) {
    setResumeToken(data.resumeSessionToken);
  }
  return data;
}

export type SetupStateResponse = {
  configured: boolean;
  data?: {
    companyId: string;
    dbMode: 'product' | 'auth_only';
    bootstrapPhase: string;
    connectionForm: {
      dbMode: 'product' | 'auth_only';
      useUrl: boolean;
      databaseUrl: string;
      host: string;
      port: string;
      user: string;
      database: string;
      ssl: boolean;
    };
  };
};

export async function fetchSetupState(): Promise<SetupStateResponse> {
  const res = await fetch(`${BASE}/state`, { headers: protectedHeaders() });
  return parseJson(res);
}

export async function verifyResumePassword(clientHashedPassword: string): Promise<{
  message: string;
  resumeSessionToken: string;
}> {
  const res = await fetch(`${BASE}/resume/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientHashedPassword }),
  });
  const data = await parseJson<{ message: string; resumeSessionToken: string }>(res);
  if (data.resumeSessionToken) {
    setResumeToken(data.resumeSessionToken);
  }
  return data;
}

export async function testConnection(payload: ConnectionPayload): Promise<ConnectionTestResult> {
  const res = await fetch(`${BASE}/connection/test`, {
    method: 'POST',
    headers: { ...protectedHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function saveConnection(payload: ConnectionPayload): Promise<{
  message: string;
  companyId?: string;
  warnings?: string[];
}> {
  const res = await fetch(`${BASE}/connection/save`, {
    method: 'POST',
    headers: { ...protectedHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function fetchAdminRegisterOptions(): Promise<{ options: AdminAuthOption[] }> {
  const res = await fetch(`${BASE}/admin/register-options`, { headers: protectedHeaders() });
  return parseJson(res);
}

export async function fetchAdminLoginMethod(): Promise<{ method: AdminLoginMethod }> {
  const res = await fetch(`${BASE}/admin/login-method`, { headers: protectedHeaders() });
  return parseJson(res);
}

export async function prepareAdminOAuth(body: {
  provider: string;
  clientId: string;
  clientSecret: string;
  tenantId?: string;
}): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/admin/oauth/prepare`, {
    method: 'POST',
    headers: { ...protectedHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function startAdminOAuth(
  mode: 'register' | 'login',
  provider: string
): Promise<{ mode: string; redirectUrl?: string; accessToken?: string; label?: string }> {
  const res = await fetch(
    `${BASE}/admin/oauth/${encodeURIComponent(provider)}/start?mode=${encodeURIComponent(mode)}`,
    { headers: protectedHeaders() }
  );
  return parseJson(res);
}

export async function registerAdmin(body: {
  email: string;
  clientHashedPassword: string;
}): Promise<{ message: string; accessToken: string }> {
  const res = await fetch(`${BASE}/bootstrap/register`, {
    method: 'POST',
    headers: { ...protectedHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function loginAdmin(body: {
  email: string;
  clientHashedPassword: string;
}): Promise<{ message: string; accessToken: string }> {
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function completeBootstrap(): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/bootstrap/complete`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  });
  return parseJson(res);
}

export async function fetchProviders(): Promise<ProvidersResponse> {
  const res = await fetch(`${BASE}/providers`, { headers: authHeaders() });
  return parseJson<ProvidersResponse>(res);
}

export async function saveProvider(
  provider: string,
  body: {
    enabled: boolean;
    clientId: string;
    clientSecret?: string;
    extraConfig: { tenantId?: string; redirectUri?: string };
  }
): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/providers/${encodeURIComponent(provider)}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function fetchPluginCatalog(): Promise<PluginCatalogResponse> {
  const res = await fetch(`${BASE}/plugins/catalog`, { headers: authHeaders() });
  return parseJson<PluginCatalogResponse>(res);
}

export async function installPlugin(pluginId: string): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/plugins/install/${encodeURIComponent(pluginId)}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function uploadPlugin(file: File): Promise<{ message: string }> {
  const form = new FormData();
  form.append('plugin', file);
  const res = await fetch(`${BASE}/plugins/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  return parseJson(res);
}

export async function deletePlugin(provider: string): Promise<{ message: string }> {
  const res = await fetch(`${BASE}/plugins/${encodeURIComponent(provider)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return parseJson(res);
}
