import { describe, expect, it } from 'vitest';
import { applyRules, findMatches, guessMapping, parseStatementAmount, parseStatementDate, parseStatementRows } from './statements';
import { advanceTemplate, dueTemplates, nextOccurrence } from './recurring';
import type { CategorisationRule, LedgerRow, RecurringTemplate } from './types';

describe('statement parsing', () => {
  it('reads common date formats', () => {
    expect(parseStatementDate('2026-09-30')).toBe('2026-09-30');
    expect(parseStatementDate('30/09/2026')).toBe('2026-09-30');
    expect(parseStatementDate('09/30/2026')).toBe('2026-09-30');
    expect(parseStatementDate('05/09/2026')).toBe('2026-09-05'); // day-first by default
    expect(parseStatementDate('05/09/2026', 'mm/dd/yyyy')).toBe('2026-05-09');
    expect(parseStatementDate('30-Sep-2026')).toBe('2026-09-30');
    expect(parseStatementDate('Sep 30, 2026')).toBe('2026-09-30');
    expect(parseStatementDate('nonsense')).toBeNull();
  });

  it('reads signed amounts in many styles', () => {
    expect(parseStatementAmount('(1,234.50)', 'LKR')).toBe(-123450);
    expect(parseStatementAmount('1,234.50 DR', 'LKR')).toBe(-123450);
    expect(parseStatementAmount('1,234.50 CR', 'LKR')).toBe(123450);
    expect(parseStatementAmount('-$45.00', 'USD')).toBe(-4500);
    expect(parseStatementAmount('', 'USD')).toBeNull();
  });

  it('maps debit/credit columns and de-duplicates identical rows by occurrence', () => {
    const headers = ['Posting Date', 'Narration', 'Debit', 'Credit', 'Balance'];
    const mapping = guessMapping(headers);
    expect(mapping).toMatchObject({ date: 'Posting Date', description: 'Narration', debit: 'Debit', credit: 'Credit', amount: null, balance: 'Balance' });
    const result = parseStatementRows(
      [
        { 'Posting Date': '01/10/2026', Narration: 'SLT bill', Debit: '5,000.00', Credit: '', Balance: '95,000.00' },
        { 'Posting Date': '01/10/2026', Narration: 'SLT bill', Debit: '5,000.00', Credit: '', Balance: '90,000.00' },
        { 'Posting Date': '02/10/2026', Narration: 'Payoneer', Debit: '', Credit: '267,300.00', Balance: '' },
        { 'Posting Date': 'bad', Narration: 'x', Debit: '1', Credit: '', Balance: '' },
      ],
      mapping,
      'LKR',
      'acc1',
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].amount_minor).toBe(-500000);
    expect(result.rows[2].amount_minor).toBe(26730000);
    expect(result.rows[0].hash).not.toBe(result.rows[1].hash);
    expect(result.errors).toEqual([{ row: 5, message: 'Unrecognised date "bad"' }]);
  });
});

describe('matching and rules', () => {
  const row = (over: Partial<LedgerRow>): LedgerRow => ({
    id: 'l', entry_id: 'e', line_no: 1, account_id: 'acc1', department_id: 'd', project_id: null, currency: 'LKR', amount_minor: -500000, fx_rate: '1', amount_lkr_minor: -500000, memo: null, role: 'money', reconciled: false, reconciled_at: null, statement_line_id: null, date: '2026-10-01', status: 'cleared', kind: 'expense', entry_number: 'EXP-1', entry_department_id: 'd', entry_description: 'SLT internet bill', party_id: null, channel: null, ...over,
  });

  it('suggests the closest unreconciled line with the same amount', () => {
    const rows = [row({ id: 'a', date: '2026-09-20' }), row({ id: 'b', date: '2026-10-02' }), row({ id: 'c', date: '2026-10-01', reconciled: true }), row({ id: 'd', amount_minor: -1 })];
    const m = findMatches({ account_id: 'acc1', amount_minor: -500000, date: '2026-10-01', description: 'SLT bill' }, rows);
    expect(m.map((x) => x.row.id)).toEqual(['b']);
  });

  it('applies the first matching rule by priority', () => {
    const rules: CategorisationRule[] = [
      { id: '1', name: 'Autodesk', match_text: 'autodesk', applies_to: 'expense', account_id: 'sw', party_id: null, department_id: null, project_id: null, priority: 2, active: true },
      { id: '2', name: 'Any autodesk refund', match_text: 'AUTODESK', applies_to: 'income', account_id: 'x', party_id: null, department_id: null, project_id: null, priority: 1, active: true },
    ];
    expect(applyRules('AUTODESK *ACAD 2027', 'expense', rules)?.id).toBe('1');
    expect(applyRules('Autodesk refund', 'income', rules)?.id).toBe('2');
    expect(applyRules('Something else', 'expense', rules)).toBeNull();
  });
});

describe('recurring', () => {
  const t: RecurringTemplate = { id: 't', name: 'Internet', kind: 'expense', frequency: 'monthly', next_date: '2026-01-31', end_date: '2026-04-15', department_id: 'd', project_id: null, party_id: null, money_account_id: 'm', category_account_id: 'c', amount_minor: 1, description: 'x', active: true };
  it('advances and ends', () => {
    expect(nextOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextOccurrence('2026-01-31', 'quarterly')).toBe('2026-04-30');
    expect(advanceTemplate({ ...t, next_date: '2026-03-31' })).toBeNull();
    expect(dueTemplates([t], '2026-01-30', 1)).toHaveLength(1);
    expect(dueTemplates([t], '2026-01-29', 1)).toHaveLength(0);
  });
});
