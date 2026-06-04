import { Card } from './ui';

export function PasswordFlowDoc() {
  return (
    <Card title="Password hash flow" description="How register and login work with this auth service.">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl bg-slate-950/60 p-4 ring-1 ring-slate-800">
          <h3 className="mb-3 text-sm font-semibold text-indigo-300">Register</h3>
          <ol className="list-decimal space-y-2 pl-4 text-sm text-slate-400">
            <li>User enters plain password in the browser.</li>
            <li>
              Browser computes <code className="rounded bg-slate-800 px-1 text-indigo-200">clientHashedPassword = SHA256(plain)</code>.
            </li>
            <li>Auth service receives email + client hash (never plain password).</li>
            <li>
              New <code className="rounded bg-slate-800 px-1">userId</code> generated;{' '}
              <code className="rounded bg-slate-800 px-1">salt = userId</code>.
            </li>
            <li>
              <code className="rounded bg-slate-800 px-1">finalHash = SHA256(clientHash + salt + pepper)</code>
            </li>
            <li>Stored in product <code className="rounded bg-slate-800 px-1">users.password</code>.</li>
          </ol>
        </div>
        <div className="rounded-xl bg-slate-950/60 p-4 ring-1 ring-slate-800">
          <h3 className="mb-3 text-sm font-semibold text-emerald-300">Login</h3>
          <ol className="list-decimal space-y-2 pl-4 text-sm text-slate-400">
            <li>Same client hash from browser.</li>
            <li>Load user by email + company ID.</li>
            <li>Recompute hash with <code className="rounded bg-slate-800 px-1">salt = user.id</code>.</li>
            <li>Compare with stored hash (timing-safe).</li>
            <li>Issue product JWT signed with JWT secret from Step 1.</li>
            <li>Frontend sends JWT to product API on every request.</li>
          </ol>
        </div>
      </div>
    </Card>
  );
}
