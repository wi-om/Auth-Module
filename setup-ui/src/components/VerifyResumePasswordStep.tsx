import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { verifyResumePassword } from '../api/setupApi';
import { sha256Hex } from '../utils/sha256';
import { toastFromError, toastSuccess } from '../utils/toast';
import { Button, Card, Input, Label } from './ui';

type Props = {
  onVerified: () => void;
};

export function VerifyResumePasswordStep({ onVerified }: Props) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    try {
      const clientHashedPassword = await sha256Hex(password);
      await verifyResumePassword(clientHashedPassword);
      setPassword('');
      onVerified();
      toastSuccess('Welcome back — continuing setup');
    } catch (err) {
      toastFromError(err, 'Incorrect password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="Resume setup"
      description="Enter the temporary setup password you created earlier. Required when you open setup in a new tab or after closing the browser, until your admin account exists."
    >
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <Label htmlFor="resumeVerify">Temporary setup password</Label>
          <Input
            id="resumeVerify"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          Continue setup
        </Button>
      </form>
    </Card>
  );
}
