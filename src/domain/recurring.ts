import { addDays, addMonths } from './period';
import type { Frequency, IsoDate, RecurringTemplate } from './types';

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

export function nextOccurrence(date: IsoDate, frequency: Frequency): IsoDate {
  switch (frequency) {
    case 'weekly':
      return addDays(date, 7);
    case 'monthly':
      return addMonths(date, 1);
    case 'quarterly':
      return addMonths(date, 3);
    case 'yearly':
      return addMonths(date, 12);
  }
}

/** Templates due on or before `asOf` (+ look-ahead days) that are still active. */
export function dueTemplates(templates: RecurringTemplate[], asOf: IsoDate, lookAheadDays = 0): RecurringTemplate[] {
  const limit = addDays(asOf, lookAheadDays);
  return templates
    .filter((t) => t.active && t.next_date <= limit && (!t.end_date || t.next_date <= t.end_date))
    .sort((a, b) => a.next_date.localeCompare(b.next_date));
}

/** After posting an occurrence, the template's next date (or null when it has ended). */
export function advanceTemplate(t: Pick<RecurringTemplate, 'next_date' | 'frequency' | 'end_date'>): IsoDate | null {
  const next = nextOccurrence(t.next_date, t.frequency);
  return t.end_date && next > t.end_date ? null : next;
}
