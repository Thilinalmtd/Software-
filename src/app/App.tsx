import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { Spinner } from '@/components/ui/misc';
import { useAppData } from '@/data/context';
import { LoginScreen, PendingScreen, SetupScreen } from '@/features/auth/AuthScreens';
import { Shell } from './Shell';

const Dashboard = lazy(() => import('@/features/dashboard/Dashboard'));
const EntriesPage = lazy(() => import('@/features/entries/EntriesPage'));
const AccountsPage = lazy(() => import('@/features/accounts/AccountsPage'));
const AccountDetail = lazy(() => import('@/features/accounts/AccountDetail'));
const ReconcilePage = lazy(() => import('@/features/reconcile/ReconcilePage'));
const ProjectsPage = lazy(() => import('@/features/projects/ProjectsPage'));
const ProjectDetail = lazy(() => import('@/features/projects/ProjectDetail'));
const ContactsPage = lazy(() => import('@/features/contacts/ContactsPage'));
const InvoicesPage = lazy(() => import('@/features/invoices/InvoicesPage'));
const BillsPage = lazy(() => import('@/features/bills/BillsPage'));
const PayrollPage = lazy(() => import('@/features/payroll/PayrollPage'));
const BudgetsPage = lazy(() => import('@/features/budgets/BudgetsPage'));
const RecurringPage = lazy(() => import('@/features/recurring/RecurringPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const AuditPage = lazy(() => import('@/features/audit/AuditPage'));

export function App() {
  const { mode, repo, ready, session, member } = useAppData();
  if (!mode) return <SetupScreen />;
  if (!ready) return <Splash />;
  if (!repo) return <SetupScreen />;
  if (!session) return <LoginScreen />;
  if (!member?.role || !member.active) return <PendingScreen />;
  return (
    <Shell>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/entries" element={<EntriesPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/accounts/:id" element={<AccountDetail />} />
          <Route path="/reconcile/:id" element={<ReconcilePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/bills" element={<BillsPage />} />
          <Route path="/payroll" element={<PayrollPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-app">
      <div className="flex flex-col items-center gap-4">
        <img src="/logo.svg" alt="" className="size-14" />
        <Spinner className="py-0" label="Opening your books…" />
      </div>
    </div>
  );
}
