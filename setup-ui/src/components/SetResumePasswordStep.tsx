import { useState } from 'react';
import { Copy, KeyRound, Loader2, Sparkles } from 'lucide-react';
import { createResumePassword } from '../api/setupApi';
import { generateTemporaryPassword } from '../utils/generatePassword';
import { sha256Hex } from '../utils/sha256';
import { toastFromError, toastSuccess } from '../utils/toast';
import { Button, Card, Input, Label } from './ui';

type Props = {
  onCreated: () => void;
};

export function SetResumePasswordStep({ onCreated }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [generated, setGenerated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const applyGenerated = (value: string) => {
    setGenerated(value);
    setPassword(value);
    setConfirm(value);
  };

  const handleGenerate = () => {
    applyGenerated(generateTemporaryPassword(16));
    toastSuccess('Password generated — copy it before continuing');
  };

  const copyGenerated = async () => {
    const text = generated || password;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    toastSuccess('Password copied to clipboard');
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (password.length < 8) {
      toastFromError(new Error('Use at least 8 characters'), 'Validation');
      return;
    }
    if (password !== confirm) {
      toastFromError(new Error('Passwords do not match'), 'Validation');
      return;
    }
    setLoading(true);
    try {
      const clientHashedPassword = await sha256Hex(password);
      const clientHashedConfirmPassword = await sha256Hex(confirm);
      const r = await createResumePassword({ clientHashedPassword, clientHashedConfirmPassword });
      toastSuccess(r.message);
      onCreated();
    } catch (err) {
      toastFromError(err, 'Could not save password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="Temporary setup password"
      description="Set a password to resume this wizard if you leave before creating your admin account. Save it somewhere safe — you will need it when you return in a new browser tab."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={handleGenerate} disabled={loading}>
            <Sparkles className="h-4 w-4" />
            Generate password
          </Button>
          {(generated || password) ? (
            <Button type="button" variant="secondary" onClick={copyGenerated} disabled={loading}>
              <Copy className="h-4 w-4" />
              Copy password
            </Button>
          ) : null}
        </div>

        {generated ? (
          <p className="rounded-lg border border-indigo-100 bg-indigo-50/80 px-3 py-2 font-mono text-sm text-indigo-950 break-all">
            {generated}
          </p>
        ) : null}

        <div>
          <Label htmlFor="resumePass">Temporary password</Label>
          <Input
            id="resumePass"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (generated && e.target.value !== generated) setGenerated(null);
            }}
          />
        </div>
        <div>
          <Label htmlFor="resumeConfirm">Confirm password</Label>
          <Input
            id="resumeConfirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (generated && e.target.value !== generated) setGenerated(null);
            }}
          />
        </div>
        <p className="text-xs text-slate-500">
          Use your own password or generate one above. After you close this browser tab, enter this password
          again to continue setup until your admin account is created.
        </p>
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Save & continue to setup
        </Button>
      </form>
    </Card>
  );
};
