import { describe, expect, it } from 'vitest';
import { accountBalances, countableRows, figuresFor } from '@/domain/reports';
import { DemoRepository, emptyStore } from './demo-repository';
import { seedDemo } from './demo-seed';

describe('demo data', () => {
  it('posts six months of valid, balanced activity', async () => {
    const repo = new DemoRepository(emptyStore(), { persist: false });
    await seedDemo(repo, '2026-09-30');
    const rows = await repo.ledger();
    const entries = await repo.list('entries');
    expect(entries.length).toBeGreaterThan(150);
    // Every entry balances in LKR
    const byEntry = new Map<string, number>();
    for (const r of rows) byEntry.set(r.entry_id, (byEntry.get(r.entry_id) ?? 0) + r.amount_lkr_minor);
    expect([...byEntry.values()].every((v) => v === 0)).toBe(true);

    const accounts = await repo.list('ledger_accounts');
    const departments = await repo.list('departments');
    const fig = figuresFor(countableRows(rows), { accounts: new Map(accounts.map((a) => [a.id, a])), departments });
    expect(fig.revenue).toBeGreaterThan(0);
    expect(fig.operatingProfit).toBeGreaterThan(0);
    for (const d of departments.filter((x) => x.is_operating)) expect(fig.byDept[d.id].revenue).toBeGreaterThan(0);

    const balances = accountBalances(rows, accounts, {});
    for (const b of balances) expect(b.balanceMinor, b.account.name).toBeGreaterThanOrEqual(0);
    expect(entries.some((e) => e.status === 'void')).toBe(true);
    expect(entries.some((e) => e.status === 'pending')).toBe(true);
  });
});
