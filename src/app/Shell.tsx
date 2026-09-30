import {
  ArrowLeftRight,
  BarChart3,
  CalendarClock,
  ChevronDown,
  FileText,
  FolderKanban,
  History,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Receipt,
  Settings,
  Sun,
  Target,
  Users,
  Wallet,
  Plug,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Badge, Menu } from '@/components/ui/misc';
import { PERIOD_PRESET_LABELS, type PeriodPreset } from '@/domain/period';
import { useAppData } from '@/data/context';
import { useDepartments, useSettings } from '@/data/hooks';
import { canRecord, isAdmin, ROLE_LABELS } from '@/data/permissions';
import { QuickAddDialog } from '@/features/entries/QuickAdd';
import { cn } from '@/lib/cn';
import { usePeriod, useUi } from './ui-state';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  admin?: boolean;
}

const NAV: { heading: string; items: NavItem[] }[] = [
  { heading: '', items: [{ to: '/', label: 'Dashboard', icon: <LayoutDashboard /> }] },
  {
    heading: 'Record',
    items: [
      { to: '/entries', label: 'Entries', icon: <ArrowLeftRight /> },
      { to: '/invoices', label: 'Invoices & quotes', icon: <FileText /> },
      { to: '/bills', label: 'Bills to pay', icon: <Receipt /> },
      { to: '/payroll', label: 'Payroll', icon: <Wallet /> },
      { to: '/recurring', label: 'Recurring', icon: <CalendarClock /> },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { to: '/accounts', label: 'Accounts', icon: <Landmark /> },
      { to: '/projects', label: 'Projects', icon: <FolderKanban /> },
      { to: '/contacts', label: 'Contacts', icon: <Users /> },
      { to: '/budgets', label: 'Budgets', icon: <Target /> },
    ],
  },
  {
    heading: 'Insight',
    items: [
      { to: '/reports', label: 'Reports', icon: <BarChart3 /> },
      { to: '/audit', label: 'Audit log', icon: <History /> },
    ],
  },
  { heading: 'Admin', items: [{ to: '/settings', label: 'Settings', icon: <Settings /> }] },
];

export function Shell({ children }: { children: ReactNode }) {
  const { member, mode, repo, disconnect } = useAppData();
  const { openQuickAdd, quickAdd, theme, setTheme } = useUi();
  const settings = useSettings();
  const navigate = useNavigate();
  const recorder = canRecord(member);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && recorder) {
        e.preventDefault();
        openQuickAdd();
      } else if (k === 'i' && e.shiftKey && recorder) {
        e.preventDefault();
        openQuickAdd({ tab: 'income' });
      } else if (k === 'e' && e.shiftKey && recorder) {
        e.preventDefault();
        openQuickAdd({ tab: 'expense' });
      } else if (k === 't' && e.shiftKey && recorder) {
        e.preventDefault();
        openQuickAdd({ tab: 'transfer' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openQuickAdd, recorder]);

  return (
    <div className="flex h-full">
      <aside className="no-print flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-ink">
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <img src="/logo.svg" alt="" className="size-9" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-white">AptoCAD Finance</p>
            <p className="truncate text-xs text-sidebar-muted">{settings.data?.company_name ?? 'AptoCAD Engineering'}</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
          {NAV.map((section) => (
            <div key={section.heading || 'top'} className="mt-3 first:mt-0">
              {section.heading && <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">{section.heading}</p>}
              {section.items
                .filter((i) => !i.admin || isAdmin(member))
                .map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      cn(
                        'relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors [&_svg]:size-4',
                        isActive ? 'bg-sidebar-2 text-white before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-brand' : 'text-sidebar-ink hover:bg-sidebar-2/60 hover:text-white',
                      )
                    }
                  >
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <Menu
            align="start"
            trigger={
              <button type="button" className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-sidebar-2">
                <span className="flex size-8 items-center justify-center rounded-full bg-brand text-[13px] font-semibold text-white">{(member?.full_name || member?.email || '?').slice(0, 1).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-white">{member?.full_name || member?.email}</span>
                  <span className="block truncate text-xs text-sidebar-muted">{ROLE_LABELS[member?.role ?? ''] ?? ''}</span>
                </span>
                <ChevronDown className="size-4 text-sidebar-muted" />
              </button>
            }
            items={[
              { label: 'Light theme', icon: <Sun />, onSelect: () => setTheme('light'), disabled: theme === 'light' },
              { label: 'Dark theme', icon: <Moon />, onSelect: () => setTheme('dark'), disabled: theme === 'dark' },
              { label: 'Match Windows', icon: <Monitor />, onSelect: () => setTheme('system'), disabled: theme === 'system' },
              'separator',
              { label: 'Keyboard shortcuts', icon: <ListChecks />, onSelect: () => navigate('/settings?tab=help') },
              { label: mode === 'demo' ? 'Leave demo / connect database' : 'Change database connection', icon: <Plug />, onSelect: () => disconnect() },
              { label: 'Sign out', icon: <LogOut />, onSelect: () => void repo?.signOut() },
            ]}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] px-8 py-6">{children}</div>
        </main>
      </div>
      {quickAdd && <QuickAddDialog />}
    </div>
  );
}

function TopBar() {
  const { dept, setDept, preset, setPreset, customRange, setCustomRange, openQuickAdd } = useUi();
  const { member, mode } = useAppData();
  const departments = useDepartments();
  const { range } = usePeriod();
  const presets = Object.entries(PERIOD_PRESET_LABELS).map(([value, label]) => ({ value, label }));
  return (
    <header className="no-print flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-8">
      <div role="radiogroup" aria-label="Department" className="inline-flex rounded-lg bg-surface-3 p-0.5">
        {[{ id: 'all', name: 'Company', color: null as string | null }, ...(departments.data ?? []).filter((d) => !d.archived).map((d) => ({ id: d.id, name: d.name, color: d.color }))].map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={dept === d.id}
            onClick={() => setDept(d.id)}
            className={cn('inline-flex h-8 cursor-pointer items-center gap-2 rounded-md px-3 text-[13px] font-medium text-ink-2 transition-colors', dept === d.id ? 'bg-surface text-ink shadow-sm' : 'hover:text-ink')}
          >
            {d.color && <span className="size-2 rounded-full" style={{ background: d.color }} />}
            {d.name}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Select aria-label="Period" className="h-9 w-56" value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset | 'custom')} options={[...presets, { value: 'custom', label: 'Custom dates…' }]} />
        {preset === 'custom' && (
          <>
            <Input type="date" aria-label="From" className="w-40" value={customRange.from} onChange={(e) => e.target.value && setCustomRange({ ...customRange, from: e.target.value })} />
            <span className="text-muted">–</span>
            <Input type="date" aria-label="To" className="w-40" value={customRange.to} onChange={(e) => e.target.value && setCustomRange({ ...customRange, to: e.target.value })} />
          </>
        )}
        {preset !== 'custom' && <span className="hidden text-xs text-muted xl:inline tabular">{range.from} → {range.to}</span>}
      </div>
      <div className="ml-auto flex items-center gap-3">
        {mode === 'demo' && <Badge tone="caution">Demo data</Badge>}
        {canRecord(member) && (
          <Button variant="primary" onClick={() => openQuickAdd()} title="New entry (Ctrl+N)">
            <Plus /> New entry <span className="rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-medium">Ctrl N</span>
          </Button>
        )}
      </div>
    </header>
  );
}
