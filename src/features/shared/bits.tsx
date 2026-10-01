import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Landmark, Scale, Wallet, Banknote, CreditCard, Globe } from 'lucide-react';
import { Badge } from '@/components/ui/misc';
import { formatMoney } from '@/domain/money';
import type { AccountType, Department, EntryKind, EntryStatus } from '@/domain/types';
import { cn } from '@/lib/cn';

export const KIND_LABELS: Record<EntryKind, string> = {
  income: 'Money in',
  expense: 'Money out',
  transfer: 'Transfer',
  payroll: 'Payroll',
  statutory_payment: 'Statutory',
  opening_balance: 'Opening',
  adjustment: 'Adjustment',
};

export function KindBadge({ kind, cross }: { kind: EntryKind; cross?: boolean }) {
  const icon = kind === 'income' ? <ArrowDownLeft className="size-3.5" /> : kind === 'expense' ? <ArrowUpRight className="size-3.5" /> : kind === 'transfer' ? <ArrowLeftRight className="size-3.5" /> : kind === 'payroll' || kind === 'statutory_payment' ? <Wallet className="size-3.5" /> : <Scale className="size-3.5" />;
  const tone = kind === 'income' ? 'positive' : kind === 'expense' ? 'negative' : kind === 'transfer' ? 'neutral' : kind === 'payroll' || kind === 'statutory_payment' ? 'info' : 'neutral';
  return (
    <Badge tone={tone}>
      {icon}
      {kind === 'transfer' && cross ? 'Dept transfer' : KIND_LABELS[kind]}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: EntryStatus }) {
  if (status === 'cleared') return <Badge tone="positive">Cleared</Badge>;
  if (status === 'pending') return <Badge tone="caution">Pending</Badge>;
  return <Badge tone="negative">Void</Badge>;
}

export function DeptTag({ dept, className }: { dept: Department | undefined; className?: string }) {
  if (!dept) return <span className="text-muted">—</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2', className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: dept.color }} />
      {dept.name}
    </span>
  );
}

/** Signed amount: money in positive (green), money out negative. */
export function Amount({ minor, currency = 'LKR', className, colored = true, plain, compact }: { minor: number; currency?: string; className?: string; colored?: boolean; plain?: boolean; compact?: boolean }) {
  return (
    <span className={cn('tabular whitespace-nowrap', colored && minor > 0 && 'text-positive', colored && minor < 0 && 'text-ink', className)}>
      {formatMoney(minor, currency, { signed: colored, plain, compact })}
    </span>
  );
}

export function AccountIcon({ type, className }: { type: AccountType; className?: string }) {
  const Icon = type === 'bank' ? Landmark : type === 'platform' ? Globe : type === 'cash' ? Banknote : CreditCard;
  return <Icon className={cn('size-4', className)} />;
}
