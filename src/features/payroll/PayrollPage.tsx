import { useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Plus, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, Sheet } from '@/components/ui/dialog';
import { Field, Input, MoneyInput } from '@/components/ui/form';
import { Badge, Callout, Card, EmptyState, PageHeader, Spinner, Tabs } from '@/components/ui/misc';
import { statutoryDueDate } from '@/domain/attention';
import { formatMoney } from '@/domain/money';
import { buildPayslipPosting, computePayslip, type PayslipFigures } from '@/domain/payroll';
import { formatDate, monthEnd, monthLabel, today } from '@/domain/period';
import { buildStatutoryPayment, PostingError, validatePosting } from '@/domain/posting';
import { liabilityBalances } from '@/domain/reports';
import type { Party, PayrollRun, Payslip } from '@/domain/types';
import { useAppData, useRepo } from '@/data/context';
import { useLedger, useLookups, usePeriodLock, usePostEntry, useTable } from '@/data/hooks';
import { canRecord, canWriteDepartment, writableDepartments } from '@/data/permissions';
import { errorMessage } from '@/lib/cn';
import { exportWorkbook, xl } from '@/lib/excel';
import { downloadPayslip } from '@/lib/pdf';
import { DeptTag } from '../shared/bits';
import { moneyAccountOptions, projectOptions } from '../shared/options';

type Tab = 'runs' | 'statutory';

export default function PayrollPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'runs';
  const L = useLookups();
  const runs = useTable('payroll_runs', { order: { column: 'period_end', ascending: false } });
  const payslips = useTable('payslips');
  const { member } = useAppData();
  const [newRun, setNewRun] = useState(false);
  const [openRun, setOpenRun] = useState<PayrollRun | null>(null);
  if (L.loading || runs.isLoading) return <Spinner />;
  const slipsByRun = new Map<string, Payslip[]>();
  for (const p of payslips.data ?? []) {
    if (!slipsByRun.has(p.run_id)) slipsByRun.set(p.run_id, []);
    slipsByRun.get(p.run_id)!.push(p);
  }
  return (
    <>
      <PageHeader
        title="Payroll"
        description="Monthly salaries with EPF (8% + 12%), ETF (3%) and APIT. Net pay leaves the bank on payday; statutory amounts are owed until paid."
        actions={canRecord(member) && tab === 'runs' && (
          <Button variant="primary" onClick={() => setNewRun(true)}>
            <Plus /> Run payroll
          </Button>
        )}
      />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ value: 'runs', label: 'Payroll runs' }, { value: 'statutory', label: 'EPF, ETF & APIT' }]} className="mb-5" />
      {tab === 'runs' ? (
        <Card padded={false}>
          <DataTable<PayrollRun>
            rows={runs.data ?? []}
            rowKey={(r) => r.id}
            onRowClick={setOpenRun}
            empty={<EmptyState icon={<Wallet />} title="No payroll yet" body="Add staff under Contacts → Staff, then run payroll for the month." />}
            columns={[
              { key: 'period', header: 'Period', cell: (r) => <span className="font-medium">{monthLabel(r.period_end)}</span>, sort: (r) => r.period_end },
              { key: 'pay', header: 'Pay date', cell: (r) => formatDate(r.pay_date), sort: (r) => r.pay_date },
              { key: 'people', header: 'People', align: 'right', cell: (r) => slipsByRun.get(r.id)?.length ?? 0 },
              { key: 'gross', header: 'Gross', align: 'right', cell: (r) => formatMoney((slipsByRun.get(r.id) ?? []).reduce((s, p) => s + p.gross_minor, 0), 'LKR', { plain: true }) },
              { key: 'net', header: 'Net paid', align: 'right', cell: (r) => formatMoney((slipsByRun.get(r.id) ?? []).reduce((s, p) => s + p.net_minor, 0), 'LKR', { plain: true }) },
              { key: 'cost', header: 'Cost to company', align: 'right', cell: (r) => <span className="font-semibold">{formatMoney((slipsByRun.get(r.id) ?? []).reduce((s, p) => s + p.gross_minor + p.employer_epf_minor + p.etf_minor, 0), 'LKR', { plain: true })}</span> },
              { key: 'status', header: 'Status', cell: (r) => <Badge tone={r.status === 'posted' ? 'positive' : 'caution'}>{r.status === 'posted' ? 'Posted' : 'Draft'}</Badge> },
            ]}
          />
        </Card>
      ) : (
        <StatutoryTab />
      )}
      {newRun && <RunPayrollDialog onClose={() => setNewRun(false)} />}
      {openRun && <RunSheet run={openRun} slips={slipsByRun.get(openRun.id) ?? []} onClose={() => setOpenRun(null)} parties={L.partyMap} />}
    </>
  );
}

function RunSheet({ run, slips, onClose, parties }: { run: PayrollRun; slips: Payslip[]; onClose: () => void; parties: Map<string, Party> }) {
  const L = useLookups();
  const navigate = useNavigate();
  const settings = L.settings!;
  const t = (k: keyof Payslip) => slips.reduce((s, p) => s + (p[k] as number), 0);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      width="max-w-5xl"
      title={`Payroll — ${monthLabel(run.period_end)}`}
      description={`Paid ${formatDate(run.pay_date)} · ${slips.length} people`}
      footer={
        <Button onClick={() => void exportWorkbook(`payroll-${run.period_end.slice(0, 7)}.xlsx`, [{ name: 'Payroll', title: `Payroll ${monthLabel(run.period_end)}`, subtitle: `Paid ${run.pay_date}`, columns: [{ header: 'Employee', key: 'name', width: 26 }, { header: 'EPF No.', key: 'epf', width: 12 }, { header: 'Department', key: 'dept', width: 16 }, { header: 'Basic', key: 'basic', type: 'money' }, { header: 'Allowances', key: 'allow', type: 'money' }, { header: 'Gross', key: 'gross', type: 'money' }, { header: 'EPF 8%', key: 'ee', type: 'money' }, { header: 'APIT', key: 'apit', type: 'money' }, { header: 'Other ded.', key: 'other', type: 'money' }, { header: 'Net pay', key: 'net', type: 'money' }, { header: 'EPF 12%', key: 'er', type: 'money' }, { header: 'ETF 3%', key: 'etf', type: 'money' }], rows: slips.map((p) => ({ name: parties.get(p.employee_id)?.name, epf: parties.get(p.employee_id)?.epf_number ?? '', dept: L.deptMap.get(p.department_id)?.name, basic: xl(p.basic_minor), allow: xl(p.epf_allowances_minor + p.other_allowances_minor), gross: xl(p.gross_minor), ee: xl(p.employee_epf_minor), apit: xl(p.apit_minor), other: xl(p.other_deductions_minor), net: xl(p.net_minor), er: xl(p.employer_epf_minor), etf: xl(p.etf_minor) })), totals: { name: 'Total', gross: xl(t('gross_minor')), ee: xl(t('employee_epf_minor')), apit: xl(t('apit_minor')), other: xl(t('other_deductions_minor')), net: xl(t('net_minor')), er: xl(t('employer_epf_minor')), etf: xl(t('etf_minor')) } }])}>
          <FileSpreadsheet /> Export (EPF/ETF schedule)
        </Button>
      }
    >
      <DataTable<Payslip>
        rows={slips}
        rowKey={(p) => p.id}
        dense
        columns={[
          { key: 'name', header: 'Employee', cell: (p) => (<div><p className="font-medium">{parties.get(p.employee_id)?.name}</p><p className="text-xs text-muted">{parties.get(p.employee_id)?.designation}</p></div>) },
          { key: 'dept', header: 'Dept', cell: (p) => <DeptTag dept={L.deptMap.get(p.department_id)} /> },
          { key: 'gross', header: 'Gross', align: 'right', cell: (p) => formatMoney(p.gross_minor, 'LKR', { plain: true }) },
          { key: 'ded', header: 'EPF 8% + APIT', align: 'right', cell: (p) => formatMoney(p.employee_epf_minor + p.apit_minor + p.other_deductions_minor, 'LKR', { plain: true }) },
          { key: 'net', header: 'Net pay', align: 'right', cell: (p) => <span className="font-semibold">{formatMoney(p.net_minor, 'LKR', { plain: true })}</span> },
          { key: 'er', header: 'EPF 12% + ETF 3%', align: 'right', cell: (p) => formatMoney(p.employer_epf_minor + p.etf_minor, 'LKR', { plain: true }) },
          {
            key: 'actions',
            header: '',
            align: 'right',
            cell: (p) => (
              <span className="inline-flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void downloadPayslip({ settings, payslip: p, employee: parties.get(p.employee_id)!, periodLabel: monthLabel(run.period_end), payDate: run.pay_date, departmentName: L.deptMap.get(p.department_id)?.name ?? '' })}>
                  <Download /> Payslip
                </Button>
                {p.entry_id && <Button size="sm" variant="ghost" onClick={() => navigate(`/entries?id=${p.entry_id}`)}>Entry</Button>}
              </span>
            ),
          },
        ]}
        footer={
          <tr className="text-[13px]">
            <td className="px-5 py-2.5" colSpan={2}>Total</td>
            <td className="px-3 py-2.5 text-right tabular">{formatMoney(t('gross_minor'), 'LKR', { plain: true })}</td>
            <td className="px-3 py-2.5 text-right tabular">{formatMoney(t('employee_epf_minor') + t('apit_minor') + t('other_deductions_minor'), 'LKR', { plain: true })}</td>
            <td className="px-3 py-2.5 text-right tabular">{formatMoney(t('net_minor'), 'LKR', { plain: true })}</td>
            <td className="px-3 py-2.5 text-right tabular">{formatMoney(t('employer_epf_minor') + t('etf_minor'), 'LKR', { plain: true })}</td>
            <td />
          </tr>
        }
      />
    </Sheet>
  );
}

interface SlipDraft {
  employee: Party;
  include: boolean;
  departmentId: string;
  projectId: string | null;
  moneyAccountId: string | null;
  basic: number | null;
  epfAllow: number | null;
  otherAllow: number | null;
  otherDed: number | null;
  apitOverride: number | null;
}

function RunPayrollDialog({ onClose }: { onClose: () => void }) {
  const L = useLookups();
  const repo = useRepo();
  const qc = useQueryClient();
  const { member } = useAppData();
  const lock = usePeriodLock();
  const post = usePostEntry();
  const settings = L.settings!;
  const [month, setMonth] = useState(today().slice(0, 7));
  const [payDate, setPayDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const bankFor = (deptId: string) => L.accounts.find((a) => a.type === 'bank' && a.currency === 'LKR' && a.department_id === deptId && !a.archived)?.id ?? null;
  const writable = writableDepartments(member, L.departments).map((d) => d.id);
  const [slips, setSlips] = useState<SlipDraft[]>(() =>
    L.parties
      .filter((p) => p.kind === 'staff' && !p.archived)
      .map((p) => {
        const dept = p.default_department_id ?? member?.department_id ?? L.departments[0].id;
        return { employee: p, include: writable.includes(dept), departmentId: dept, projectId: null, moneyAccountId: bankFor(dept), basic: p.basic_salary_minor, epfAllow: 0, otherAllow: 0, otherDed: 0, apitOverride: null };
      }),
  );
  const figures = useMemo(
    () =>
      slips.map((s): PayslipFigures | string => {
        try {
          const isEmployee = s.employee.staff_type !== 'contractor';
          return computePayslip({ basicMinor: s.basic ?? 0, epfAllowancesMinor: s.epfAllow ?? 0, otherAllowancesMinor: s.otherAllow ?? 0, otherDeductionsMinor: s.otherDed ?? 0, epfApplicable: isEmployee, apitApplicable: isEmployee, apitOverrideMinor: s.apitOverride }, settings.payroll);
        } catch (e) {
          return errorMessage(e);
        }
      }),
    [slips, settings.payroll],
  );
  const update = (i: number, patch: Partial<SlipDraft>) => setSlips((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const included = slips.map((s, i) => ({ s, f: figures[i] })).filter((x) => x.s.include);
  const totals = included.reduce((t, x) => (typeof x.f === 'string' ? t : { gross: t.gross + x.f.gross_minor, net: t.net + x.f.net_minor, cost: t.cost + x.f.cost_minor }), { gross: 0, net: 0, cost: 0 });

  const accounts = {
    salaries: L.sys('salaries')!,
    employerEpf: L.sys('employer_epf')!,
    employerEtf: L.sys('employer_etf')!,
    epfPayable: L.sys('epf_payable')!,
    etfPayable: L.sys('etf_payable')!,
    apitPayable: L.sys('apit_payable')!,
    otherDeductionsPayable: L.sys('other_deductions_payable')!,
  };

  const run = async () => {
    const periodEnd = monthEnd(`${month}-01`);
    const label = monthLabel(periodEnd);
    // Validate everything before writing anything
    const drafts = [];
    for (const { s, f } of included) {
      if (typeof f === 'string') return toast.error(`${s.employee.name}: ${f}`);
      const money = L.accountMap.get(s.moneyAccountId ?? '');
      if (!money) return toast.error(`${s.employee.name}: choose the account salaries are paid from.`);
      try {
        const draft = buildPayslipPosting({ runId: 'pending', payDate, periodLabel: label, employeeId: s.employee.id, employeeName: s.employee.name, departmentId: s.departmentId, projectId: s.projectId, moneyAccount: money, figures: f, accounts });
        const issues = validatePosting(draft, { accounts: L.accountMap, departments: L.deptMap, lockedThrough: lock.data ?? null });
        if (issues.length) return toast.error(`${s.employee.name}: ${issues.join(' ')}`);
        drafts.push({ s, f, money });
      } catch (e) {
        return toast.error(`${s.employee.name}: ${e instanceof PostingError ? e.issues.join(' ') : errorMessage(e)}`);
      }
    }
    if (!drafts.length) return toast.error('Include at least one person.');
    setBusy(true);
    try {
      const runRow = await repo.insert('payroll_runs', { period_end: periodEnd, pay_date: payDate, status: 'draft', notes: null });
      for (const { s, f, money } of drafts) {
        const draft = buildPayslipPosting({ runId: runRow.id, payDate, periodLabel: label, employeeId: s.employee.id, employeeName: s.employee.name, departmentId: s.departmentId, projectId: s.projectId, moneyAccount: money, figures: f, accounts });
        const entry = await post.mutateAsync({ draft });
        const { cost_minor: _c, epf_base_minor: _b, ...stored } = f;
        void _c; void _b;
        await repo.insert('payslips', { run_id: runRow.id, employee_id: s.employee.id, department_id: s.departmentId, project_id: s.projectId, money_account_id: money.id, epf_applicable: s.employee.staff_type !== 'contractor', basic_minor: s.basic ?? 0, epf_allowances_minor: s.epfAllow ?? 0, other_allowances_minor: s.otherAllow ?? 0, ...stored, entry_id: entry.id });
      }
      await repo.update('payroll_runs', runRow.id, { status: 'posted' });
      await qc.invalidateQueries({ queryKey: ['payroll_runs'] });
      await qc.invalidateQueries({ queryKey: ['payslips'] });
      toast.success(`Payroll for ${label} posted`, { description: `${drafts.length} payslips · net ${formatMoney(totals.net)}` });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
      await qc.invalidateQueries({ queryKey: ['payroll_runs'] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="full"
      title="Run payroll"
      description="Check each person's pay. EPF, ETF and APIT are calculated from the rates in Settings; you can override APIT with the official table figure."
      footer={
        <>
          <span className="mr-auto text-[13px] text-ink-2">
            {included.length} people · gross <b className="tabular">{formatMoney(totals.gross)}</b> · net <b className="tabular">{formatMoney(totals.net)}</b> · cost <b className="tabular">{formatMoney(totals.cost)}</b>
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void run()}>Post payroll</Button>
        </>
      }
    >
      <div className="mb-4 flex gap-4">
        <Field label="Month"><Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-44" /></Field>
        <Field label="Pay date"><Input type="date" value={payDate} onChange={(e) => e.target.value && setPayDate(e.target.value)} className="w-44" /></Field>
      </div>
      {slips.length === 0 ? (
        <EmptyState title="No staff yet" body="Add employees and contractors under Contacts → Staff first." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-2 font-medium">Pay</th>
                <th className="py-2 pr-2 font-medium">Person</th>
                <th className="py-2 pr-2 font-medium">Paid from / project</th>
                <th className="w-40 py-2 pr-2 text-right font-medium">Basic</th>
                <th className="w-36 py-2 pr-2 text-right font-medium">Other allowances</th>
                <th className="w-36 py-2 pr-2 text-right font-medium">Other deductions</th>
                <th className="w-36 py-2 pr-2 text-right font-medium">APIT</th>
                <th className="py-2 text-right font-medium">Net pay</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s, i) => {
                const f = figures[i];
                const allowed = canWriteDepartment(member, s.departmentId, L.departments);
                return (
                  <tr key={s.employee.id} className="border-b border-line align-top">
                    <td className="py-2.5 pr-2"><input type="checkbox" aria-label={`Include ${s.employee.name}`} disabled={!allowed} checked={s.include} onChange={(e) => update(i, { include: e.target.checked })} /></td>
                    <td className="py-2 pr-2">
                      <p className="font-medium">{s.employee.name}</p>
                      <p className="text-xs text-muted">{s.employee.staff_type === 'contractor' ? 'Contractor' : 'Employee'} · {L.deptMap.get(s.departmentId)?.name}</p>
                    </td>
                    <td className="w-64 py-2 pr-2">
                      <Combobox aria-label="Paid from" options={moneyAccountOptions(L.accounts.filter((a) => a.currency === 'LKR'), L.departments, { departmentIds: writable })} value={s.moneyAccountId} onChange={(v) => update(i, { moneyAccountId: v })} />
                      <div className="mt-1.5"><Combobox aria-label="Project" options={projectOptions(L.projects, s.departmentId)} value={s.projectId} onChange={(v) => update(i, { projectId: v })} allowClear placeholder="No project" /></div>
                    </td>
                    <td className="py-2 pr-2"><MoneyInput aria-label="Basic" value={s.basic} onChange={(v) => update(i, { basic: v })} /></td>
                    <td className="py-2 pr-2"><MoneyInput aria-label="Other allowances" value={s.otherAllow} onChange={(v) => update(i, { otherAllow: v })} /></td>
                    <td className="py-2 pr-2"><MoneyInput aria-label="Other deductions" value={s.otherDed} onChange={(v) => update(i, { otherDed: v })} /></td>
                    <td className="py-2 pr-2">
                      <MoneyInput aria-label="APIT" value={s.apitOverride ?? (typeof f === 'string' ? null : f.apit_minor)} onChange={(v) => update(i, { apitOverride: v })} />
                      {s.apitOverride !== null && <button type="button" className="mt-1 cursor-pointer text-xs text-info" onClick={() => update(i, { apitOverride: null })}>Use calculated</button>}
                    </td>
                    <td className="py-2.5 text-right tabular">
                      {typeof f === 'string' ? (
                        <span className="text-xs text-negative">{f}</span>
                      ) : (
                        <>
                          <p className="font-semibold">{formatMoney(f.net_minor, 'LKR', { plain: true })}</p>
                          <p className="text-xs text-muted">EPF {formatMoney(f.employee_epf_minor, 'LKR', { plain: true, whole: true })} / {formatMoney(f.employer_epf_minor + f.etf_minor, 'LKR', { plain: true, whole: true })}</p>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Callout className="mt-4" tone="info">APIT is estimated from the monthly bands in Settings → Payroll &amp; tax. For special cases (bonuses, secondary employment) enter the figure from the IRD APIT tables.</Callout>
    </Dialog>
  );
}

function StatutoryTab() {
  const L = useLookups();
  const ledger = useLedger();
  const navigate = useNavigate();
  const { member } = useAppData();
  const [paying, setPaying] = useState(false);
  const liabilities = useMemo(() => liabilityBalances(ledger.data ?? [], L.accounts).filter((l) => l.account.type === 'liability'), [ledger.data, L.accounts]);
  const history = (ledger.data ?? []).filter((r) => r.kind === 'statutory_payment' && r.role === 'money' && r.status !== 'void').sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {liabilities.map((l) => (
          <div key={l.account.id} className="rounded-xl border border-line bg-surface px-5 py-4">
            <p className="text-[13px] text-ink-2">{l.account.name.replace(' Payable', '')} owed</p>
            <p className="mt-1 text-xl font-semibold tabular">{formatMoney(l.owedMinor)}</p>
            <p className="mt-0.5 text-xs text-muted">{l.owedMinor > 0 ? `Pay by ${formatDate(statutoryDueDate(l.account.system_key, today()))}` : 'Nothing owed'}</p>
          </div>
        ))}
      </div>
      <Card title="Payments" action={canRecord(member) && <Button variant="primary" onClick={() => setPaying(true)} disabled={!liabilities.some((l) => l.owedMinor > 0)}><Plus /> Record payment</Button>} padded={false}>
        <DataTable
          rows={history}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/entries?id=${r.entry_id}`)}
          empty={<EmptyState title="No statutory payments yet" />}
          columns={[
            { key: 'date', header: 'Date', cell: (r) => formatDate(r.date) },
            { key: 'desc', header: 'Description', cell: (r) => (<div><p>{r.entry_description}</p><p className="text-xs text-muted">{r.entry_number}</p></div>) },
            { key: 'account', header: 'Paid from', cell: (r) => L.accountMap.get(r.account_id)?.name },
            { key: 'amt', header: 'Amount', align: 'right', cell: (r) => formatMoney(-r.amount_minor, 'LKR', { plain: true }) },
          ]}
        />
      </Card>
      {paying && <StatutoryPaymentDialog owed={liabilities} onClose={() => setPaying(false)} />}
    </div>
  );
}

function StatutoryPaymentDialog({ owed, onClose }: { owed: { account: import('@/domain/types').LedgerAccount; owedMinor: number }[]; onClose: () => void }) {
  const L = useLookups();
  const { member } = useAppData();
  const post = usePostEntry();
  const writable = writableDepartments(member, L.departments);
  const [date, setDate] = useState(today());
  const [accountId, setAccountId] = useState<string | null>(L.accounts.find((a) => a.type === 'bank' && a.currency === 'LKR' && writable.some((d) => d.id === a.department_id))?.id ?? null);
  const [amounts, setAmounts] = useState<Record<string, number | null>>(Object.fromEntries(owed.map((o) => [o.account.id, Math.max(0, o.owedMinor)])));
  const [reference, setReference] = useState('');
  const submit = async () => {
    const money = L.accountMap.get(accountId ?? '');
    if (!money) return toast.error('Choose the account you paid from.');
    try {
      const draft = buildStatutoryPayment({ date, description: `Statutory payment — ${owed.filter((o) => amounts[o.account.id]).map((o) => o.account.name.replace(' Payable', '')).join(', ')}`, reference, departmentId: money.department_id!, moneyAccount: money, payments: owed.map((o) => ({ account: o.account, amountMinor: amounts[o.account.id] ?? 0 })) });
      await post.mutateAsync({ draft });
      toast.success('Statutory payment recorded');
      onClose();
    } catch (e) {
      toast.error(e instanceof PostingError ? e.issues.join(' ') : errorMessage(e));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Record EPF / ETF / APIT payment" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={post.isPending} onClick={() => void submit()}>Record payment</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Paid from"><Combobox options={moneyAccountOptions(L.accounts.filter((a) => a.currency === 'LKR'), L.departments, { departmentIds: writable.map((d) => d.id) })} value={accountId} onChange={setAccountId} /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
        {owed.map((o) => (
          <Field key={o.account.id} label={o.account.name} hint={`Owed ${formatMoney(o.owedMinor)}`}>
            <MoneyInput value={amounts[o.account.id] ?? null} onChange={(v) => setAmounts({ ...amounts, [o.account.id]: v })} />
          </Field>
        ))}
        <Field label="Reference" className="col-span-2" hint="e.g. EPF C-form number or IRD payment reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

