import { useEffect, useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { fetchAdminLoginMethod, loginAdmin, startAdminOAuth } from '../api/setupApi';
import type { AdminLoginMethod } from '../types';
import { sha256Hex } from '../utils/sha256';
import { setAdminToken } from '../utils/authSession';
import { toastFromError, toastSuccess } from '../utils/toast';
import { Button, Card, Input, Label } from './ui';
import { ProviderIcon } from './ProviderIcon';

type Props = {
  onLoggedIn: () => void;
};

export function LoginPage({ onLoggedIn }: Props) {
  const [method, setMethod] = useState<AdminLoginMethod | null>(null);
  const [loadingMethod, setLoadingMethod] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAdminLoginMethod()
      .then((r) => setMethod(r.method))
      .catch((e) => toastFromError(e, 'Could not load sign-in method'))
      .finally(() => setLoadingMethod(false));
  }, []);

  const submitPassword = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !password) {
      toastFromError(new Error('Email and password are required'), 'Validation failed');
      return;
    }
    setLoading(true);
    try {
      const clientHashedPassword = await sha256Hex(password);
      const r = await loginAdmin({ email: email.trim(), clientHashedPassword });
      setAdminToken(r.accessToken);
      toastSuccess('Signed in successfully');
      onLoggedIn();
    } catch (err) {
      toastFromError(err, 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const submitOAuth = async () => {
    if (!method || method.type !== 'oauth') return;
    setLoading(true);
    try {
      const r = await startAdminOAuth('login', method.provider);
      if (r.mode === 'token' && r.accessToken) {
        setAdminToken(r.accessToken);
        toastSuccess('Signed in successfully');
        onLoggedIn();
        return;
      }
      if (r.redirectUrl) {
        window.location.href = r.redirectUrl;
        return;
      }
      toastFromError(new Error('OAuth did not return a redirect URL'), 'Login failed');
    } catch (err) {
      toastFromError(err, 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  if (loadingMethod) {
    return (
      <Card title="Admin sign in" description="Loading…">
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </Card>
    );
  }

  if (!method) {
    return (
      <Card title="Admin sign in" description="No admin sign-in method is configured.">
        <p className="text-sm text-slate-600">Complete admin registration first.</p>
      </Card>
    );
  }

  const isPassword = method.type === 'password';

  return (
    <Card
      title="Admin sign in"
      description={
        isPassword
          ? 'Use the email and password you created during setup.'
          : `Sign in with ${method.label} — the method chosen when the admin account was created.`
      }
    >
      {isPassword ? (
        <form className="space-y-4" onSubmit={submitPassword}>
          <div>
            <Label htmlFor="loginEmail">Email</Label>
            <Input
              id="loginEmail"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="loginPassword">Password</Label>
            <Input
              id="loginPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white">
              <ProviderIcon providerId={method.provider} type="oauth" className="h-6 w-6" />
            </div>
            <div>
              <p className="font-medium text-slate-900">{method.label}</p>
              <p className="text-xs text-slate-500">Organization admin sign-in</p>
            </div>
          </div>
          <Button type="button" className="w-full" onClick={submitOAuth} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in with {method.label}
          </Button>
        </div>
      )}
    </Card>
  );
}
