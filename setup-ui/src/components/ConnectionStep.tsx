import { useEffect, useState } from 'react';
import { Database, Loader2, Save, Server } from 'lucide-react';
import { fetchSetupState, saveConnection, SetupResumeRequiredError, testConnection } from '../api/setupApi';
import { clearAdminToken } from '../utils/authSession';
import type { ConnectionPayload, DbMode } from '../types';
import { toastFromError, toastSuccess } from '../utils/toast';
import { Button, Card, Input, Label } from './ui';

type Props = {
  dbConnected: boolean;
  onSaved: () => void;
  onResumeRequired?: () => void;
};

const defaultForm = {
  databaseUrl: '',
  host: 'localhost',
  port: '5432',
  user: 'postgres',
  password: '',
  database: 'postgres',
  ssl: false,
};

export function ConnectionStep({ dbConnected, onSaved, onResumeRequired }: Props) {
  const [dbMode, setDbMode] = useState<DbMode>('product');
  const [useUrl, setUseUrl] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState<'test' | 'save' | 'load' | null>(null);

  useEffect(() => {
    if (!dbConnected) return;
    setLoading('load');
    fetchSetupState()
      .then((s) => {
        const cf = s.data?.connectionForm;
        if (!cf) return;
        setDbMode(cf.dbMode);
        setUseUrl(cf.useUrl);
        setForm({
          databaseUrl: cf.databaseUrl,
          host: cf.host,
          port: cf.port,
          user: cf.user,
          password: '',
          database: cf.database,
          ssl: cf.ssl,
        });
      })
      .catch(() => {
        /* non-fatal — user can re-enter */
      })
      .finally(() => setLoading(null));
  }, [dbConnected]);

  const payload = (): ConnectionPayload => {
    if (useUrl) {
      return { dbMode, databaseUrl: form.databaseUrl.trim() };
    }
    return {
      dbMode,
      host: form.host.trim(),
      port: form.port.trim(),
      user: form.user.trim(),
      password: form.password,
      database: form.database.trim(),
      ssl: form.ssl,
    };
  };

  const runTest = async () => {
    setLoading('test');
    try {
      const r = await testConnection(payload());
      const extra = r.warnings?.length ? ` ${r.warnings.join('; ')}` : '';
      toastSuccess(`${r.message}${extra}`);
    } catch (e) {
      if (e instanceof SetupResumeRequiredError) {
        onResumeRequired?.();
        return;
      }
      toastFromError(e, 'Connection failed');
    } finally {
      setLoading(null);
    }
  };

  const runSave = async () => {
    setLoading('save');
    try {
      const r = await saveConnection(payload());
      clearAdminToken();
      toastSuccess(r.message);
      onSaved();
    } catch (e) {
      if (e instanceof SetupResumeRequiredError) {
        onResumeRequired?.();
        return;
      }
      toastFromError(e, 'Save failed');
    } finally {
      setLoading(null);
    }
  };

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Card
      title="Database connection"
      description={
        dbConnected
          ? 'Your saved connection is shown below (password is not stored in the browser). Update if needed, then continue.'
          : 'Register your PostgreSQL database using server details or a full connection URL.'
      }
    >
      <div className="space-y-4">
        {loading === 'load' ? (
          <p className="text-sm text-slate-500">Loading saved connection…</p>
        ) : null}

        <div>
          <Label>Database mode</Label>
          <div className="mt-2 flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="dbMode"
                checked={dbMode === 'product'}
                onChange={() => setDbMode('product')}
                className="text-indigo-600"
              />
              Product app database
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="dbMode"
                checked={dbMode === 'auth_only'}
                onChange={() => setDbMode('auth_only')}
                className="text-indigo-600"
              />
              Auth-only database
            </label>
          </div>
        </div>

        <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          <button
            type="button"
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
              !useUrl ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => setUseUrl(false)}
          >
            <Server className="h-4 w-4" />
            Server, port, user & password
          </button>
          <button
            type="button"
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
              useUrl ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
            onClick={() => setUseUrl(true)}
          >
            <Database className="h-4 w-4" />
            Connection URL
          </button>
        </div>

        {!useUrl ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="host">Server / host</Label>
              <Input id="host" placeholder="localhost or db.example.com" value={form.host} onChange={set('host')} />
            </div>
            <div>
              <Label htmlFor="port">Port</Label>
              <Input id="port" placeholder="5432" value={form.port} onChange={set('port')} />
            </div>
            <div>
              <Label htmlFor="user">User</Label>
              <Input id="user" placeholder="postgres" value={form.user} onChange={set('user')} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="off"
                placeholder={dbConnected ? 'Re-enter password to change connection' : ''}
                value={form.password}
                onChange={set('password')}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="database">Database name</Label>
              <Input id="database" placeholder="postgres" value={form.database} onChange={set('database')} />
            </div>
            <div className="sm:col-span-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.ssl}
                  onChange={(e) => setForm((f) => ({ ...f, ssl: e.target.checked }))}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Require SSL (e.g. Azure PostgreSQL)
              </label>
            </div>
          </div>
        ) : (
          <div>
            <Label htmlFor="databaseUrl">PostgreSQL connection URL</Label>
            <Input
              id="databaseUrl"
              type="password"
              autoComplete="off"
              placeholder="postgresql://user:pass@host:5432/dbname"
              value={form.databaseUrl}
              onChange={set('databaseUrl')}
            />
            {dbConnected ? (
              <p className="mt-1 text-xs text-slate-500">
                Stored URL is masked. Paste the full URL again if you need to change it.
              </p>
            ) : null}
          </div>
        )}

        <p className="text-xs text-slate-500">
          Auth peppers and JWT secret are set in the auth service <code className="text-indigo-700">.env</code>, not
          on this screen.
        </p>

        <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={runTest} disabled={loading !== null}>
            {loading === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Test connection
          </Button>
          <Button type="button" onClick={runSave} disabled={loading !== null}>
            {loading === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save & continue
          </Button>
        </div>
      </div>
    </Card>
  );
}
