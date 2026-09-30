import { describe, expect, it } from 'vitest';
import { carryingRate, formatMoney, fromLkrMinor, pctOf, toLkrMinor, toMinor } from './money';
import { addMonths, fiscalYear, fiscalMonths, presetRange, calendarQuarter, isIsoDate } from './period';

describe('money', () => {
  it('parses user input into minor units', () => {
    expect(toMinor('1,250.50', 'USD')).toBe(125050);
    expect(toMinor('0.1', 'LKR')).toBe(10);
    expect(toMinor('1250.005', 'LKR')).toBe(125001); // half-up
    expect(toMinor('abc', 'LKR')).toBeNull();
    expect(toMinor('', 'LKR')).toBeNull();
    expect(toMinor(99.99, 'USD')).toBe(9999);
  });

  it('converts to LKR without floating point drift', () => {
    expect(toLkrMinor(90000, 'USD', '300')).toBe(27000000);
    expect(toLkrMinor(10, 'USD', '302.4567')).toBe(3025); // 0.10 × 302.4567 = 30.24567 → 30.25
    expect(toLkrMinor(12345, 'LKR', '999')).toBe(12345);
    expect(fromLkrMinor(27000000, 'USD', '300')).toBe(90000);
  });

  it('computes the average carrying rate of a foreign balance', () => {
    // 900 USD booked at 300 plus 100 USD at 310 → 1000 USD with LKR 301,000 book value
    expect(carryingRate(100000, 30100000, 'USD')).toBe('301');
    expect(carryingRate(0, 0, 'USD')).toBeNull();
    expect(carryingRate(500, 500, 'LKR')).toBe('1');
  });

  it('formats like the workbook', () => {
    expect(formatMoney(123456789, 'LKR')).toBe('LKR 1,234,567.89');
    expect(formatMoney(-150000, 'LKR', { brackets: true })).toBe('(LKR 1,500.00)');
    expect(formatMoney(-150000, 'LKR', { plain: true })).toBe('−1,500.00');
    expect(formatMoney(1240000000, 'LKR', { compact: true })).toBe('LKR 12.4M');
  });

  it('rounds percentages half-up', () => {
    expect(pctOf(8333333, 6)).toBe(500000);
    expect(pctOf(1001, 50)).toBe(501);
  });
});

describe('period', () => {
  it('finds the Sri Lankan financial year (April–March)', () => {
    expect(fiscalYear('2026-10-02', 4)).toMatchObject({ startYear: 2026, label: 'FY 2026/27', range: { from: '2026-04-01', to: '2027-03-31' } });
    expect(fiscalYear('2027-03-31', 4).startYear).toBe(2026);
    expect(fiscalYear('2027-04-01', 4).startYear).toBe(2027);
    expect(fiscalYear('2026-06-15', 1)).toMatchObject({ label: '2026', range: { from: '2026-01-01', to: '2026-12-31' } });
  });

  it('lists the 12 months of a financial year', () => {
    const months = fiscalMonths(2026, 4);
    expect(months[0]).toBe('2026-04-01');
    expect(months[11]).toBe('2027-03-01');
  });

  it('adds months clamping to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('builds preset ranges', () => {
    expect(presetRange('last_month', 4, '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('fy_to_date', 4, '2026-10-02')).toEqual({ from: '2026-04-01', to: '2026-10-02' });
    expect(presetRange('last_fy', 4, '2026-10-02')).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(calendarQuarter('2026-08-20')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });
});
