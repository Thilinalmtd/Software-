import type { ComboOption } from '@/components/ui/combobox';
import { GROUP_LABELS } from '@/domain/reports';
import { MONEY_ACCOUNT_TYPES, type CategoryGroup, type Department, type LedgerAccount, type Party, type PartyKind, type Project } from '@/domain/types';

const TYPE_LABEL: Record<string, string> = { bank: 'Bank', platform: 'Platform', cash: 'Cash', card: 'Card' };

export function moneyAccountOptions(accounts: LedgerAccount[], departments: Department[], opts: { departmentIds?: string[] } = {}): ComboOption[] {
  const deptMap = new Map(departments.map((d) => [d.id, d]));
  return accounts
    .filter((a) => MONEY_ACCOUNT_TYPES.includes(a.type) && !a.archived && (!opts.departmentIds || opts.departmentIds.includes(a.department_id!)))
    .sort((a, b) => (deptMap.get(a.department_id!)?.sort_order ?? 9) - (deptMap.get(b.department_id!)?.sort_order ?? 9) || a.name.localeCompare(b.name))
    .map((a) => ({ value: a.id, label: a.name, hint: `${a.currency} · ${TYPE_LABEL[a.type] ?? a.type}`, group: deptMap.get(a.department_id!)?.name, color: deptMap.get(a.department_id!)?.color }));
}

export function categoryOptions(accounts: LedgerAccount[], groups: CategoryGroup[]): ComboOption[] {
  return accounts
    .filter((a) => a.category_group && groups.includes(a.category_group) && !a.archived)
    .sort((a, b) => groups.indexOf(a.category_group!) - groups.indexOf(b.category_group!) || a.code.localeCompare(b.code))
    .map((a) => ({ value: a.id, label: a.name, hint: a.code, group: GROUP_LABELS[a.category_group!] }));
}

export function projectOptions(projects: Project[], departmentId?: string | null, includeClosed = false): ComboOption[] {
  return projects
    .filter((p) => !p.archived && (!departmentId || p.department_id === departmentId) && (includeClosed || (p.status !== 'completed' && p.status !== 'cancelled')))
    .map((p) => ({ value: p.id, label: p.name, hint: p.code }));
}

export function partyOptions(parties: Party[], kinds: PartyKind[]): ComboOption[] {
  return parties.filter((p) => kinds.includes(p.kind) && !p.archived).map((p) => ({ value: p.id, label: p.name, hint: p.country ?? undefined, group: kinds.length > 1 ? p.kind[0].toUpperCase() + p.kind.slice(1) + 's' : undefined }));
}

export function departmentOptions(departments: Department[], allowed?: Department[]) {
  const ids = allowed ? new Set(allowed.map((d) => d.id)) : null;
  return departments.filter((d) => !d.archived).map((d) => ({ value: d.id, label: d.name, disabled: ids ? !ids.has(d.id) : false }));
}
