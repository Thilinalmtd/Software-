import { Clock, Database, LogOut, PlayCircle, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, SegmentedControl } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';
import { apiKeyProblem, getConnection, normaliseSupabaseUrl, verifyConnection } from '@/data/config';
import { useAppData } from '@/data/context';
import { RepositoryError } from '@/data/repository';
import { errorMessage } from '@/lib/cn';

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: ReactNode }) {
  return (
    <div className="flex h-full overflow-y-auto bg-app">
      <div className="relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="" className="size-10" />
          <span className="text-lg font-semibold">AptoCAD Finance</span>
        </div>
        <div>
          <p className="text-[32px] leading-tight font-semibold tracking-tight">Every rupee, per department and per project.</p>
          <p className="mt-4 max-w-md text-[15px] text-sidebar-ink">
            Income, expenses, payroll and transfers for Civil and Mechanical — in LKR, with USD, CAD, GBP and EUR clients, Upwork and Payoneer handled properly.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-sidebar-ink">
            {['Transfers never distort profit', 'Payroll with EPF, ETF and APIT', 'Month lock and a full audit trail', 'Reports that match your Excel tracker'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="size-1.5 rounded-full bg-brand" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-muted">© AptoCAD Engineering</p>
        <div className="pointer-events-none absolute -right-24 -bottom-24 size-80 rounded-full bg-brand/20 blur-3xl" />
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          <img src="/logo.svg" alt="" className="mb-6 size-11 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-ink-2">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SetupScreen() {
  const { startDemo, connect } = useAppData();
  const existing = getConnection();
  const [url, setUrl] = useState(existing?.url ?? '');
  const [key, setKey] = useState(existing?.anonKey ?? '');
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const base = normaliseSupabaseUrl(url);
  const urlError = url.trim() && !base ? 'Paste the Project URL, like https://abcdefgh.supabase.co (not the database connection string).' : null;
  const keyError = apiKeyProblem(key, base);
  const valid = !!base && key.trim().length > 20 && !keyError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!base || !valid) return;
    const c = { url: base, anonKey: key.trim() };
    setChecking(true);
    setFailure(null);
    try {
      await verifyConnection(c);
      connect(c);
    } catch (err) {
      setFailure(errorMessage(err));
      setChecking(false);
    }
  };

  return (
    <AuthLayout title="Welcome" subtitle="Connect to your company database, or look around with sample data first.">
      <div className="space-y-4">
        <button type="button" onClick={() => void startDemo()} className="flex w-full cursor-pointer items-start gap-4 rounded-xl border border-line bg-surface p-4 text-left shadow-sm transition-colors hover:border-line-strong hover:bg-surface-2">
          <PlayCircle className="mt-0.5 size-5 shrink-0 text-brand" />
          <span>
            <span className="block font-semibold text-ink">Try the demo</span>
            <span className="mt-0.5 block text-[13px] text-ink-2">Six months of sample AptoCAD data, stored only on this PC. Nothing is shared.</span>
          </span>
        </button>
        <form className="rounded-xl border border-line bg-surface p-5 shadow-sm" onSubmit={submit}>
          <div className="mb-4 flex items-center gap-3">
            <Database className="size-5 text-info" />
            <p className="font-semibold text-ink">Connect the company database</p>
          </div>
          <div className="space-y-3">
            <Field
              label="Supabase project URL"
              htmlFor="sb-url"
              error={urlError}
              hint={base && base !== url.trim().replace(/\/+$/, '') ? <>Will connect to <span className="font-medium text-ink-2">{base}</span></> : 'Supabase → Connect (top of the project page), or Project Settings → Data API → Project URL'}
            >
              <Input id="sb-url" placeholder="https://abcdefgh.supabase.co" value={url} onChange={(e) => { setUrl(e.target.value); setFailure(null); }} />
            </Field>
            <Field label="Publishable key" htmlFor="sb-key" error={keyError} hint="Project Settings → API Keys → Publishable key (sb_publishable_…). The legacy “anon” key also works. Never paste a secret or service_role key here.">
              <Input id="sb-key" placeholder="sb_publishable_…" value={key} onChange={(e) => { setKey(e.target.value); setFailure(null); }} />
            </Field>
          </div>
          {failure && <Callout className="mt-4" tone="negative" title="Could not connect">{failure}</Callout>}
          <Button type="submit" variant="primary" className="mt-4 w-full" disabled={!valid} loading={checking}>
            {checking ? 'Checking…' : 'Connect'}
          </Button>
          <p className="mt-3 text-xs text-muted">Both directors use the same URL and key. See docs/SETUP.md for the 10-minute setup.</p>
        </form>
      </div>
    </AuthLayout>
  );
}

/** Plain-language versions of the Supabase Auth errors people actually meet. */
function authProblem(err: unknown): string {
  const code = err instanceof RepositoryError ? err.code : undefined;
  switch (code) {
    case 'invalid_credentials':
      return 'Wrong email or password.';
    case 'otp_expired':
      return 'That code is wrong or has expired. Use the code from the latest email, or send a new one.';
    case 'over_email_send_rate_limit':
      return 'Supabase’s built-in email sends only a few emails an hour. Try again later, or ask the admin to set up email sending (docs/SETUP.md).';
    case 'email_address_not_authorized':
      return 'Supabase’s built-in email only sends to members of the company’s Supabase team. Ask the admin to turn off “Confirm email” or set up email sending (docs/SETUP.md).';
    case 'user_already_exists':
    case 'email_exists':
      return 'There is already an account for this email. Sign in, or use Forgot password.';
    case 'same_password':
      return 'Choose a password different from your old one.';
    case 'signup_disabled':
      return 'New accounts are turned off for this database. Ask the admin.';
    default:
      return errorMessage(err);
  }
}

type Tab = 'signin' | 'signup' | 'reset';

export function LoginScreen() {
  const { repo, mode, disconnect } = useAppData();
  const [tab, setTab] = useState<Tab>('signin');
  // After sign-up (or a reset request) the email carries a code; the app asks for it here.
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [email, setEmail] = useState(mode === 'demo' ? 'demo@aptocad.lk' : '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const switchTab = (t: Tab) => {
    setTab(t);
    setAwaitingCode(false);
    setMessage(null);
    setCode('');
  };

  const run = async (action: () => Promise<void>) => {
    if (!repo) return;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (err instanceof RepositoryError && err.code === 'email_not_confirmed') {
        setTab('signup');
        setAwaitingCode(true);
        setMessage('This email address is not confirmed yet. Enter the code from the confirmation email, or send a new one.');
      } else toast.error(authProblem(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    void run(async () => {
      if (!repo) return;
      const addr = email.trim();
      if (awaitingCode && tab === 'signup') await repo.confirmEmail(addr, code.trim());
      else if (awaitingCode && tab === 'reset') await repo.completePasswordReset(addr, code.trim(), password);
      else if (tab === 'signin') await repo.signIn(addr, password);
      else if (tab === 'signup') {
        const r = await repo.signUp(addr, password, name.trim());
        if (r.needsConfirmation) {
          setAwaitingCode(true);
          setCode('');
        }
      } else {
        await repo.resetPassword(addr);
        setAwaitingCode(true);
        setPassword('');
        setCode('');
      }
    });
  };

  const resend = () =>
    void run(async () => {
      if (!repo) return;
      if (tab === 'reset') await repo.resetPassword(email.trim());
      else await repo.resendConfirmation(email.trim());
      setMessage('A new email is on its way. Use the code from the newest one.');
    });

  if (awaitingCode) {
    const reset = tab === 'reset';
    return (
      <AuthLayout title={reset ? 'Set a new password' : 'Confirm your email'} subtitle={<>We emailed a code to <span className="font-medium text-ink">{email.trim()}</span>.</>}>
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Code from the email" htmlFor="code">
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} className="tracking-[0.3em] tabular" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
          </Field>
          {reset && (
            <Field label="New password" htmlFor="new-password" hint="At least 8 characters.">
              <Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
          )}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={code.length < 6}>
            {reset ? 'Set new password' : 'Confirm email'}
          </Button>
        </form>
        {message && <Callout className="mt-4" tone="info">{message}</Callout>}
        <Callout className="mt-4" tone="neutral" title="Only a link in the email, no code?">
          {reset
            ? 'Ask the admin to switch the “Reset password” email to the code version (docs/SETUP.md, step 1). The link cannot open this app.'
            : 'Click the link once. The page it opens may say “This site can’t be reached” — that is fine, your email is confirmed. Then come back here and sign in.'}
        </Callout>
        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2">
          <button type="button" onClick={resend} disabled={busy} className="cursor-pointer underline-offset-4 hover:underline disabled:opacity-50">
            Send a new code
          </button>
          <button type="button" onClick={() => switchTab('signin')} className="cursor-pointer underline-offset-4 hover:underline">
            Back to sign in
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={tab === 'signup' ? 'Create your account' : tab === 'reset' ? 'Reset your password' : 'Sign in'} subtitle={mode === 'demo' ? 'Demo mode — any password works.' : 'Use your work email.'}>
      <SegmentedControl
        className="mb-5"
        value={tab}
        onChange={switchTab}
        options={[
          { value: 'signin', label: 'Sign in' },
          { value: 'signup', label: 'Create account' },
          { value: 'reset', label: 'Forgot password' },
        ]}
      />
      <form className="space-y-3" onSubmit={submit}>
        {tab === 'signup' && (
          <Field label="Full name" htmlFor="name">
            <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        {tab !== 'reset' && (
          <Field label="Password" htmlFor="password" hint={tab === 'signup' ? 'At least 8 characters.' : undefined}>
            <Input id="password" type="password" autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} minLength={tab === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} required={mode !== 'demo'} />
          </Field>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          {tab === 'signin' ? 'Sign in' : tab === 'signup' ? 'Create account' : 'Email me a code'}
        </Button>
      </form>
      {message && <Callout className="mt-4" tone="info">{message}</Callout>}
      <button type="button" onClick={disconnect} className="mt-6 cursor-pointer text-[13px] text-ink-2 underline-offset-4 hover:underline">
        {mode === 'demo' ? 'Leave demo' : 'Use a different database'}
      </button>
    </AuthLayout>
  );
}

export function PendingScreen() {
  const { repo, member, refreshMember } = useAppData();
  return (
    <AuthLayout title="Waiting for approval" subtitle={`Signed in as ${member?.email ?? 'your account'}.`}>
      <Callout tone="caution" icon={<Clock />} title={member?.active === false ? 'Your access has been turned off' : 'An admin needs to give you access'}>
        Ask the company admin to open Settings → Users and assign you a role (for example, Department director).
      </Callout>
      <div className="mt-5 flex gap-2">
        <Button onClick={() => void refreshMember()}>
          <ShieldCheck /> Check again
        </Button>
        <Button variant="ghost" onClick={() => void repo?.signOut()}>
          <LogOut /> Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}
