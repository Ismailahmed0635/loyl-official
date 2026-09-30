'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FadeUp } from '@/components/animations/FadeUp';
import { adminLogin } from '@/lib/api/admin';
import { ShieldCheck } from 'lucide-react';

/**
 * /admin/login — dedicated password sign-in for the super admin.
 * Separate from merchant email sign-in (Phase 5); the password lives
 * in ADMIN_PASSWORD, attempts are rate-limited server-side, sessions last 12h.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminLogin({ password });
      if (res?.success) {
        router.replace('/admin');
        return;
      }
      const code = res?.error?.code;
      if (code === 'ADMIN_NOT_CONFIGURED') {
        setError('Admin login is not configured on this deployment (set ADMIN_PASSWORD).');
      } else if (code === 'ADMIN_LOCKED_OUT') {
        setError('Too many failed attempts. Wait a minute, then try again.');
      } else if (code === 'VALIDATION_ERROR') {
        setError(res?.error?.message || 'Password must be at least 8 characters.');
      } else {
        setError(res?.error?.message || 'Sign-in failed. Try again.');
      }
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-surface px-4 py-12">
      <FadeUp className="w-full max-w-sm">
        <Card className="p-8 shadow-ambient">
          <div className="mb-6 flex flex-col items-center text-center">
            <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-card bg-brand-green text-white shadow-inset-light">
              <ShieldCheck size={22} />
            </span>
            <h1 className="font-headline-md text-headline-md text-on-surface">Loyl Admin</h1>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
              Restricted area — platform team only.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              label="Admin password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
            {error && (
              <p
                role="alert"
                className="rounded-input border border-hairline bg-error-container px-3 py-2 font-body-sm text-body-sm font-medium text-on-error-container"
              >
                {error}
              </p>
            )}
            <Button type="submit" isLoading={busy} disabled={password.length === 0}>
              Sign in
            </Button>
          </form>

          <p className="mt-6 text-center font-label-sm text-label-sm text-on-surface-variant">
            Sessions expire after 12 hours. Failed attempts are rate-limited.
          </p>
        </Card>
      </FadeUp>
    </main>
  );
}
