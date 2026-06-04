import { useCallback, useEffect, useState } from 'react';
import { fetchBootstrapStatus, SetupResumeRequiredError } from './api/setupApi';
import type { BootstrapStatus } from './types';
import { AppLayout } from './components/AppLayout';
import { ConnectionStep } from './components/ConnectionStep';
import { RegisterStep } from './components/RegisterStep';
import { LoginPage } from './components/LoginPage';
import { ProvidersStep } from './components/ProvidersStep';
import { SetResumePasswordStep } from './components/SetResumePasswordStep';
import { VerifyResumePasswordStep } from './components/VerifyResumePasswordStep';
import { clearAdminToken, getAdminToken, setAdminToken } from './utils/authSession';
import { clearResumeSession, getResumeToken } from './utils/resumeSession';
import { toastFromError, toastSuccess } from './utils/toast';

export default function App() {
  const [status, setStatus] = useState<BootstrapStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenVersion, setTokenVersion] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchBootstrapStatus();
      if (!s.hasAdmin) {
        clearAdminToken();
      }
      if (s.resumePasswordConfigured && s.resumeRequired && !s.resumeSessionValid) {
        clearResumeSession();
      }
      setStatus(s);
    } catch (e) {
      if (e instanceof SetupResumeRequiredError) {
        clearResumeSession();
        setStatus({
          phase: 'connection',
          dbConnected: false,
          hasAdmin: false,
          setupComplete: false,
          dbMode: null,
          companyId: null,
          adminLoginMethod: null,
          resumePasswordConfigured: true,
          resumeRequired: true,
          resumeSessionValid: false,
        });
      } else {
        const msg = e instanceof Error ? e.message : 'Could not load setup status';
        toastFromError(e, msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onPageShow = () => {
      void refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('accessToken');
    const oauthErr = params.get('admin_oauth_error');
    if (oauthErr) {
      toastFromError(new Error(decodeURIComponent(oauthErr)), 'Admin sign-in failed');
      window.history.replaceState({}, '', '/setup');
      return;
    }
    if (params.get('admin_oauth') && token) {
      setAdminToken(token);
      clearResumeSession();
      toastSuccess('Admin account ready');
      window.history.replaceState({}, '', '/setup');
      setTokenVersion((v) => v + 1);
      refresh();
    }
  }, [refresh]);

  const hasToken = Boolean(getAdminToken());
  const hasAdmin = Boolean(status?.hasAdmin);
  const resumeConfigured = Boolean(status?.resumePasswordConfigured);
  const resumeRequired = Boolean(status?.resumeRequired);
  const dbConnected = Boolean(status?.dbConnected);
  const needsResumeGate = resumeConfigured && resumeRequired && !hasAdmin;
  const resumeSessionOk = !needsResumeGate || status?.resumeSessionValid === true;

  const showSetResume = !loading && !resumeConfigured && !hasAdmin;

  const showVerifyResume = !loading && needsResumeGate && !resumeSessionOk;

  const resumeGateOpen = !loading && resumeSessionOk;

  const wizardUnlocked = !loading && resumeGateOpen;

  const showConnection =
    wizardUnlocked && !showSetResume && !showVerifyResume && !dbConnected;

  const showRegister =
    wizardUnlocked &&
    !showSetResume &&
    !showVerifyResume &&
    dbConnected &&
    !hasAdmin &&
    !showConnection;

  const showLogin =
    wizardUnlocked &&
    !showSetResume &&
    !showVerifyResume &&
    dbConnected &&
    hasAdmin &&
    !hasToken;

  const showProviders =
    wizardUnlocked &&
    !showSetResume &&
    !showVerifyResume &&
    dbConnected &&
    hasAdmin &&
    hasToken;

  const anyStep =
    showSetResume ||
    showVerifyResume ||
    showConnection ||
    showRegister ||
    showLogin ||
    showProviders;

  useEffect(() => {
    if (!loading && dbConnected && !hasAdmin && hasToken) {
      clearAdminToken();
      setTokenVersion((v) => v + 1);
    }
  }, [loading, dbConnected, hasAdmin, hasToken]);

  const handleLogout = () => {
    clearAdminToken();
    setTokenVersion((v) => v + 1);
    refresh();
  };

  const handleLoggedIn = () => {
    clearResumeSession();
    setTokenVersion((v) => v + 1);
    refresh();
  };

  const handleResumePasswordCreated = () => {
    void refresh();
  };

  const handleResumeVerified = () => {
    void refresh();
  };

  const handleWizardRefresh = () => {
    void refresh();
  };

  const handleResumeRequired = () => {
    clearResumeSession();
    void refresh();
  };

  const title = showVerifyResume
    ? 'Resume setup'
    : showSetResume
      ? 'Setup'
      : showLogin
        ? 'Sign in'
        : showConnection
          ? 'Setup'
          : showRegister
            ? 'Setup'
            : showProviders
              ? 'Configuration'
              : 'Setup';

  const subtitle = showVerifyResume
    ? 'Enter temporary setup password'
    : showSetResume
      ? 'Step 0 · Temporary resume password'
      : showLogin
        ? 'Administrator access'
        : showConnection
          ? 'Step 1 · Database connection'
          : showRegister
            ? 'Step 2 · Create admin account'
            : showProviders
              ? 'Auth providers & plugins'
              : 'Loading wizard…';

  const meta =
    dbConnected && status?.companyId
      ? `Mode: ${status.dbMode ?? '—'} · Company ${status.companyId.slice(0, 8)}…`
      : undefined;

  return (
    <AppLayout
      key={tokenVersion}
      title={title}
      subtitle={subtitle}
      meta={meta}
      showLogout={showProviders}
      onLogout={handleLogout}
      centered={showLogin || showVerifyResume || showSetResume}
    >
      {loading ? <p className="text-center text-slate-500">Loading…</p> : null}

      {showSetResume ? <SetResumePasswordStep onCreated={handleResumePasswordCreated} /> : null}
      {showVerifyResume ? <VerifyResumePasswordStep onVerified={handleResumeVerified} /> : null}
      {showConnection ? (
        <ConnectionStep
          dbConnected={dbConnected}
          onSaved={handleWizardRefresh}
          onResumeRequired={handleResumeRequired}
        />
      ) : null}
      {showRegister ? <RegisterStep onRegistered={handleLoggedIn} /> : null}
      {showLogin ? <LoginPage onLoggedIn={handleLoggedIn} /> : null}
      {showProviders ? (
        <ProvidersStep
          setupComplete={Boolean(status?.setupComplete)}
          onComplete={handleWizardRefresh}
        />
      ) : null}

      {!loading && !anyStep ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-medium">Setup state could not be determined.</p>
          <p className="mt-1 text-amber-900">
            {resumeConfigured && !hasAdmin
              ? 'Enter your temporary setup password to continue.'
              : 'Reload the page or check that the auth service is running.'}
          </p>
          {resumeConfigured && !hasAdmin ? (
            <button
              type="button"
              className="mt-3 text-sm font-semibold text-indigo-700 underline"
              onClick={handleResumeRequired}
            >
              Show resume password screen
            </button>
          ) : null}
        </div>
      ) : null}
    </AppLayout>
  );
}
