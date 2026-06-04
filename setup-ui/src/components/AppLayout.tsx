import type { ReactNode } from 'react';
import { LogOut, Shield } from 'lucide-react';
import { Button } from './ui';
import { clearAdminToken } from '../utils/authSession';

type Props = {
  title: string;
  subtitle: string;
  meta?: string;
  showLogout?: boolean;
  onLogout?: () => void;
  children: ReactNode;
  centered?: boolean;
};

export function AppLayout({
  title,
  subtitle,
  meta,
  showLogout,
  onLogout,
  children,
  centered,
}: Props) {
  const handleLogout = () => {
    clearAdminToken();
    onLogout?.();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-indigo-50/30">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
                Auth microservice
              </p>
              <h1 className="text-xl font-bold text-slate-900">{title}</h1>
              <p className="text-sm text-slate-600">{subtitle}</p>
              {meta ? <p className="mt-1 text-xs text-slate-500">{meta}</p> : null}
            </div>
          </div>
          {showLogout ? (
            <Button type="button" variant="secondary" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          ) : null}
        </div>
      </header>

      <main
        className={`mx-auto max-w-5xl px-4 py-8 ${centered ? 'flex min-h-[calc(100vh-88px)] items-center justify-center' : ''}`}
      >
        <div className={centered ? 'w-full max-w-md' : 'w-full'}>{children}</div>
      </main>
    </div>
  );
}
