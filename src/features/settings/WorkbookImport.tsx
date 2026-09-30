import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, MoneyInput } from '@/components/ui/form';
import { Callout } from '@/components/ui/misc';
import { formatMoney } from '@/domain/money';
import { addDays, today } from '@/domain/period';
import { useRepo } from '@/data/context';
import { useLookups } from '@/data/hooks';
import { executeImport, planImport, readWorkbook, type ExecuteResult, type ImportPlan } from '@/data/workbook-import';
import { errorMessage } from '@/lib/cn';

export function WorkbookImport({ onClose }: { onClose: () => void }) {
  const L = useLookups();
  const repo = useRepo();
  const qc = useQueryClient();
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [openingDate, setOpeningDate] = useState(today());
  const [foreign, setForeign] = useState<Record<string, number | null>>({});
  const [parity, setParity] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const load = async (file: File) => {
    try {
      setFileName(file.name);
      const p = planImport(await readWorkbook(file));
      setPlan(p);
      const first = p.money[0]?.date;
      if (first) setOpeningDate(addDays(first, -1));
    } catch (e) {
      toast.error(`Could not read the workbook: ${errorMessage(e)}`);
    }
  };
  const run = async () => {
    if (!plan) return;
    try {
      setProgress({ done: 0, total: plan.money.length });
      const res = await executeImport(plan, repo, { departments: L.departments, accounts: L.accounts, parties: L.parties, projects: L.projects }, { openingDate, foreignOpening: foreign, payrollParity: parity, onProgress: (done, total) => setProgress({ done, total }) });
      setResult(res);
      await qc.invalidateQueries();
      toast.success(`Imported ${res.created.entries} entries`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };
  const foreignAccounts = plan?.accounts.filter((a) => a.currency !== 'LKR' && a.openingLkrMinor !== 0 && !L.accounts.some((x) => x.name.toLowerCase() === a.name.toLowerCase())) ?? [];
  const empty = plan && plan.accounts.length + plan.projects.length + plan.money.length === 0;

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !progress && onClose()}
      size="lg"
      title="Import the AptoCAD Excel tracker"
      description={fileName || 'Choose the .xlsx file (the one with START HERE, Income, Expenses, Payroll, Transfers, Projects and Accounts sheets).'}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={!!progress}>Cancel</Button>
            <Button variant="primary" disabled={!plan || !!empty || !!progress} loading={!!progress} onClick={() => void run()}>
              {progress ? `Importing ${progress.done}/${progress.total}…` : 'Import'}
            </Button>
          </>
        )
      }
    >
      {!plan ? (
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-strong px-6 py-12 text-center hover:bg-surface-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void load(f); }}>
          <FileSpreadsheet className="size-7 text-muted" />
          <span className="font-medium">Drop the workbook here, or click to choose</span>
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        </label>
      ) : result ? (
        <div className="space-y-3">
          <Callout tone="positive" title="Import finished">
            Created {result.created.accounts} accounts, {result.created.contacts} contacts, {result.created.projects} projects and {result.created.entries} entries.{result.alreadyImported ? ` ${result.alreadyImported} row(s) had already been imported and were skipped.` : ''}
          </Callout>
          {result.issues.length > 0 && (
            <Callout tone="caution" title={`${result.issues.length} row(s) were not imported`}>
              <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-4">{result.issues.map((i, k) => <li key={k}>{i.sheet}{i.row ? ` row ${i.row}` : ''}: {i.message}</li>)}</ul>
            </Callout>
          )}
          <p className="text-[13px] text-ink-2">Check Reports → Monthly summary against the workbook&apos;s Monthly Summary sheet. If a row failed, fix it in the workbook and import again — rows already imported (same sheet and ID) are skipped, so nothing is duplicated.</p>
        </div>
      ) : empty ? (
        <Callout tone="info" icon={<Upload />} title="This workbook has no data yet">It is the empty template — nothing to import. Start recording directly in the app.</Callout>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3 text-center text-[13px]">
            {[['Accounts', plan.accounts.length], ['Projects', plan.projects.length], ['Contacts', plan.clients.length + plan.vendors.length + plan.staff.length], ['Entries', plan.money.length]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2 p-3"><p className="text-xl font-semibold tabular">{v}</p><p className="text-ink-2">{k}</p></div>
            ))}
          </div>
          {plan.skippedVoid > 0 && <p className="text-[13px] text-ink-2">{plan.skippedVoid} voided row(s) will be skipped.</p>}
          {plan.issues.length > 0 && (
            <Callout tone="caution" title={`${plan.issues.length} row(s) need attention and will be skipped`}>
              <ul className="mt-1 max-h-36 list-disc overflow-y-auto pl-4">{plan.issues.map((i, k) => <li key={k}>{i.sheet} row {i.row}: {i.message}</li>)}</ul>
            </Callout>
          )}
          <Field label="Opening balances dated" hint="Usually the day before your first imported transaction."><Input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} className="w-48" /></Field>
          {foreignAccounts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-ink-2">The workbook stores opening balances only in LKR. Enter each foreign account&apos;s actual opening balance in its own currency:</p>
              {foreignAccounts.map((a) => (
                <div key={a.name} className="grid grid-cols-[1fr_200px] items-center gap-3 text-[13px]">
                  <span>{a.name} <span className="text-muted">({formatMoney(a.openingLkrMinor)} in the workbook)</span></span>
                  <MoneyInput currency={a.currency} value={foreign[a.name] ?? null} onChange={(v) => setForeign({ ...foreign, [a.name]: v })} />
                </div>
              ))}
            </div>
          )}
          <label className="flex items-start gap-2 text-[13px] text-ink-2">
            <input type="checkbox" className="mt-0.5" checked={parity} onChange={(e) => setParity(e.target.checked)} />
            <span>Post payroll the way the workbook did (gross pay + employer extras leave the paying account). Untick to record only net pay from the bank and keep deductions as EPF owed.</span>
          </label>
        </div>
      )}
    </Dialog>
  );
}
