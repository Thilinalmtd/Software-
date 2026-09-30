import type { Department, Member, Uuid } from '@/domain/types';

// Mirrors the database's can_write_department() so the UI only offers what the server allows.

export function canWriteDepartment(member: Member | null, departmentId: Uuid | null | undefined, departments: Department[]): boolean {
  if (!member?.role || !member.active || !departmentId) return false;
  if (member.role === 'admin' || member.role === 'bookkeeper') return true;
  if (member.role !== 'director') return false;
  if (member.department_id === departmentId) return true;
  return departments.some((d) => d.id === departmentId && !d.is_operating);
}

export function writableDepartments(member: Member | null, departments: Department[]): Department[] {
  return departments.filter((d) => !d.archived && canWriteDepartment(member, d.id, departments));
}

export const canRecord = (m: Member | null) => !!m?.role && m.role !== 'viewer' && m.active;
export const isAdmin = (m: Member | null) => m?.role === 'admin' && m.active;
export const canEditChart = (m: Member | null) => m?.role === 'admin' || m?.role === 'bookkeeper';
export const canEditMaster = (m: Member | null) => !!m?.role && m.role !== 'viewer';

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  director: 'Department director',
  bookkeeper: 'Bookkeeper',
  viewer: 'Read-only (accountant)',
};
