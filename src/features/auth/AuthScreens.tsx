import { Clock, Database, LogOut, PlayCircle, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, SegmentedControl } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';
import { getConnection, isValidSupabaseUrl } from '@/data/config';
import { useAppData } from '@/data/context';
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
  const valid = isValidSupabaseUrl(url) && key.trim().length > 20;
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
        <form
          className="rounded-xl border border-line bg-surface p-5 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) connect({ url, anonKey: key });
          }}
        >
          <div className="mb-4 flex items-center gap-3">
            <Database className="size-5 text-info" />
            <p className="font-semibold text-ink">Connect the company database</p>
          </div>
          <div className="space-y-3">
            <Field label="Supabase project URL" htmlFor="sb-url" hint="Supabase → Connect (top of the project page), or Project Settings → Data API → Project URL">
              <Input id="sb-url" placeholder="https://abcdefgh.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <Field label="Publishable key" htmlFor="sb-key" hint="Project Settings → API Keys → Publishable key (sb_publishable_…). The legacy “anon” key also works. Never paste a secret or service_role key here.">
              <Input id="sb-key" placeholder="sb_publishable_…" value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="primary" className="mt-4 w-full" disabled={!valid}>
            Connect
          </Button>
          <p className="mt-3 text-xs text-muted">Both directors use the same URL and key. See docs/SETUP.md for the 10-minute setup.</p>
        </form>
      </div>
    </AuthLayout>
  );
}

export function LoginScreen() {
  const { repo, mode, disconnect } = useAppData();
  const [tab, setTab] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState(mode === 'demo' ? 'demo@aptocad.lk' : '');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!repo) return;
    setBusy(true);
    setMessage(null);
    try {
      if (tab === 'signin') await repo.signIn(email, password);
      else if (tab === 'signup') {
        const r = await repo.signUp(email, password, name);
        if (r.needsConfirmation) setMessage('Check your email to confirm your address, then sign in. An admin will then approve your access.');
      } else {
        await repo.resetPassword(email);
        setMessage('If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={tab === 'signup' ? 'Create your account' : tab === 'reset' ? 'Reset your password' : 'Sign in'} subtitle={mode === 'demo' ? 'Demo mode — any password works.' : 'Use your work email.'}>
      <SegmentedControl
        className="mb-5"
        value={tab}
        onChange={setTab}
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
          {tab === 'signin' ? 'Sign in' : tab === 'signup' ? 'Create account' : 'Send reset link'}
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
