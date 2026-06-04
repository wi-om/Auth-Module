import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, UserPlus } from 'lucide-react';
import {
  fetchAdminRegisterOptions,
  prepareAdminOAuth,
  registerAdmin,
  startAdminOAuth,
} from '../api/setupApi';
import type { AdminAuthOption } from '../types';
import { sha256Hex } from '../utils/sha256';
import { setAdminToken } from '../utils/authSession';
import { clearResumeSession } from '../utils/resumeSession';
import { toastFromError, toastSuccess } from '../utils/toast';
import { Button, Card, Input, Label } from './ui';
import { ProviderIcon } from './ProviderIcon';

type Props = {
  onRegistered: () => void;
};

export function RegisterStep({ onRegistered }: Props) {
  const [options, setOptions] = useState<AdminAuthOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [selected, setSelected] = useState<AdminAuthOption | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadOptions = () => {
    setLoadingOptions(true);
    setLoadError(null);
    fetchAdminRegisterOptions()
      .then((r) => setOptions(r.options || []))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : 'Could not load sign-in options';
        setLoadError(msg);
        setOptions([]);
        toastFromError(e, 'Could not load sign-in options');
      })
      .finally(() => setLoadingOptions(false));
  };

  useEffect(() => {
    loadOptions();
  }, []);

  const submitPassword = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (password !== confirm) {
      toastFromError(new Error('Passwords do not match'), 'Validation failed');
      return;
    }
    if (password.length < 8) {
      toastFromError(new Error('Password must be at least 8 characters'), 'Validation failed');
      return;
    }
    setLoading(true);
    try {
      const clientHashedPassword = await sha256Hex(password);
      const r = await registerAdmin({ email: email.trim(), clientHashedPassword });
      setAdminToken(r.accessToken);
      clearResumeSession();
      toastSuccess(r.message);
      onRegistered();
    } catch (err) {
      toastFromError(err, 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const submitOAuth = async () => {
    if (!selected || selected.type !== 'oauth') return;
    if (!clientId.trim() || !clientSecret.trim()) {
      toastFromError(new Error('Client ID and Client secret are required'), 'Validation failed');
      return;
    }
    setLoading(true);
    try {
      await prepareAdminOAuth({
        provider: selected.id,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        tenantId: tenantId.trim() || undefined,
      });
      const r = await startAdminOAuth('register', selected.id);
      if (r.mode === 'token' && r.accessToken) {
        setAdminToken(r.accessToken);
        clearResumeSession();
        toastSuccess('Admin account created');
        onRegistered();
        return;
      }
      if (r.redirectUrl) {
        window.location.href = r.redirectUrl;
        return;
      }
      toastFromError(new Error('OAuth did not return a redirect URL'), 'Registration failed');
    } catch (err) {
      toastFromError(err, 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  if (loadingOptions) {
    return (
      <Card title="Create admin account" description="Loading sign-in options…">
        <div className="flex justify-center py-8 text-slate-500">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Card>
    );
  }

  if (!selected) {
    return (
      <Card
        title="How will administrators sign in?"
        description="How administrators sign in to this setup wizard only. End-user sign-in (Google, Entra, password, etc.) is configured separately in the next step."
      >
        {loadError && !loadingOptions ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {loadError}
            <Button type="button" variant="secondary" className="mt-3" onClick={loadOptions}>
              Retry
            </Button>
          </div>
        ) : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {options.map((opt) => (
            <li key={opt.id}>
              <button
                type="button"
                onClick={() => setSelected(opt)}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-100 bg-white">
                  <ProviderIcon providerId={opt.id} type={opt.type} />
                </div>
                <div>
                  <p className="font-medium text-slate-900">{opt.label}</p>
                  <p className="text-xs capitalize text-slate-500">{opt.type}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  const isPassword = selected.type === 'password';
  const isEntra = selected.id === 'entra' || selected.id === 'microsoft';

  return (
    <Card
      title={isPassword ? 'Create admin with email' : `Register with ${selected.label}`}
      description={
        isPassword
          ? 'This account manages auth plugins. Password is hashed in the browser before sending.'
          : 'Enter your IdP app credentials, then continue to sign in and create the admin account.'
      }
    >
      <button
        type="button"
        onClick={() => setSelected(null)}
        className="mb-4 flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800"
      >
        <ArrowLeft className="h-4 w-4" />
        Change sign-in method
      </button>

      {isPassword ? (
        <form className="space-y-4" onSubmit={submitPassword}>
          <div>
            <Label htmlFor="email">Admin email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Create admin & continue
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div>
            <Label>Client ID</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="From your IdP app registration" />
          </div>
          <div>
            <Label>Client secret</Label>
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Required for OAuth"
            />
          </div>
          {isEntra ? (
            <div>
              <Label>Tenant ID</Label>
              <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Directory (tenant) ID" />
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            Redirect URI for your IdP app:{' '}
            <code className="text-indigo-700">
              {typeof window !== 'undefined'
                ? `${window.location.origin}/setup/admin/oauth/${selected.id}/callback`
                : `/setup/admin/oauth/${selected.id}/callback`}
            </code>
          </p>
          <Button type="button" onClick={submitOAuth} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Continue with {selected.label}
          </Button>
        </div>
      )}
    </Card>
  );
}
