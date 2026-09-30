import { expect, test, type Page } from '@playwright/test';

// End-to-end tests of the main workflows, in demo mode (sample data, no database).

async function startDemo(page: Page) {
  await page.goto('/');
  await page.getByText('Try the demo').click();
  await expect(page.getByRole('heading', { name: 'Company overview' })).toBeVisible({ timeout: 30_000 });
}

async function pick(page: Page, combobox: string, search: string) {
  await page.getByRole('combobox', { name: combobox, exact: true }).click();
  await page.getByPlaceholder('Type to search…').fill(search);
  await page.keyboard.press('Enter');
}

async function openQuickAdd(page: Page, tab: 'Money in' | 'Money out' | 'Move money') {
  await page.keyboard.press('Control+n');
  const dialog = page.getByRole('dialog', { name: 'New entry' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: tab }).click();
  return dialog;
}

test('dashboard shows department figures and navigates', async ({ page }) => {
  await startDemo(page);
  await expect(page.getByText('Revenue', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Needs attention')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Civil' }).first()).toBeVisible();
  await page.getByRole('radio', { name: 'Mechanical' }).click();
  await expect(page.getByRole('heading', { name: 'Mechanical department' })).toBeVisible();
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByText('Monthly summary —')).toBeVisible();
});

test('records an expense with Ctrl+N and finds it in Entries', async ({ page }) => {
  await startDemo(page);
  const dialog = await openQuickAdd(page, 'Money out');
  await dialog.getByLabel('Amount', { exact: true }).fill('12,345.50');
  await pick(page, 'Account', 'Civil — Commercial');
  await pick(page, 'Category 1', 'Software & Subscriptions');
  await dialog.getByLabel('Description').fill('E2E Bluebeam licence');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved EXP-\d{4}-\d{5}/)).toBeVisible();
  await page.getByRole('link', { name: 'Entries' }).click();
  await page.getByLabel('Search entries').fill('Bluebeam');
  await expect(page.getByRole('cell', { name: /E2E Bluebeam licence/ })).toBeVisible();
  await expect(page.getByText('−LKR 12,345.50')).toBeVisible();
});

test('records an Upwork payout gross with the fee as a cost', async ({ page }) => {
  await startDemo(page);
  const dialog = await openQuickAdd(page, 'Money in');
  await dialog.getByLabel('Amount', { exact: true }).fill('1000');
  await pick(page, 'Account', 'Upwork — Civil');
  await dialog.getByLabel('Exchange rate').fill('300');
  await pick(page, 'Category', 'Permit / Construction Drawings');
  await dialog.getByText(/A fee was deducted/).click();
  await dialog.getByLabel('Fee', { exact: true }).fill('100');
  await expect(dialog.getByText('Net received:')).toContainText('USD 900.00');
  await dialog.getByLabel('Description').fill('E2E Upwork milestone');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved INC-/)).toBeVisible();
  await page.getByRole('link', { name: 'Entries' }).click();
  await page.getByLabel('Search entries').fill('E2E Upwork');
  await page.getByRole('cell', { name: /E2E Upwork milestone/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('cell', { name: 'Fee', exact: true })).toBeVisible();
  await expect(sheet.getByRole('cell', { name: '−300,000.00' })).toBeVisible(); // revenue LKR
  await expect(sheet.getByRole('cell', { name: '30,000.00' })).toBeVisible(); // fee LKR
});

test('moving USD to an LKR bank books the exchange difference', async ({ page }) => {
  await startDemo(page);
  const dialog = await openQuickAdd(page, 'Move money');
  await pick(page, 'Account', 'Payoneer — Civil');
  await pick(page, 'To account', 'Civil — Commercial');
  await dialog.getByLabel('Amount', { exact: true }).fill('100');
  await dialog.getByLabel('Amount received').fill('20,000');
  await expect(dialog.getByText(/Realised exchange loss/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved TRF-/)).toBeVisible();
});

test('explains what is missing instead of saving a bad entry', async ({ page }) => {
  await startDemo(page);
  const dialog = await openQuickAdd(page, 'Money out');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByText('Please check')).toBeVisible();
  await expect(dialog.getByText(/Choose the account you paid from/)).toBeVisible();
});

test('voids an entry with a reason and keeps it on record', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('link', { name: 'Entries' }).click();
  await page.getByRole('tab', { name: 'Money out' }).click();
  await page.locator('tbody tr').first().click();
  const sheet = page.getByRole('dialog');
  const number = (await sheet.getByRole('heading').first().textContent())?.match(/EXP-\d{4}-\d{5}/)?.[0];
  await sheet.getByRole('button', { name: 'Void' }).click();
  await page.getByLabel('Why is it being voided?').fill('E2E duplicate');
  await page.getByRole('button', { name: 'Void entry' }).click();
  await expect(page.getByText(`${number} voided`)).toBeVisible();
  await expect(page.getByRole('dialog').getByText('E2E duplicate')).toBeVisible();
});

test('month lock blocks entries in a closed period', async ({ page }) => {
  await startDemo(page);
  await page.goto('/#/settings?tab=lock');
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByText('Books locked')).toBeVisible();
  const dialog = await openQuickAdd(page, 'Money out');
  await dialog.getByLabel('Date').fill('2020-01-15');
  await dialog.getByLabel('Amount', { exact: true }).fill('10');
  await pick(page, 'Account', 'Civil — Commercial');
  await pick(page, 'Category 1', 'Utilities');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByText(/books are locked/)).toBeVisible();
});

test('runs payroll with EPF, ETF and APIT', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('link', { name: 'Payroll' }).click();
  await expect(page.getByRole('heading', { name: 'Payroll' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /2026/ }).first()).toBeVisible();
  const before = await page.locator('tbody tr').count();
  await page.getByRole('button', { name: 'Run payroll' }).click();
  const dialog = page.getByRole('dialog', { name: 'Run payroll' });
  await dialog.getByLabel('Month').fill('2027-01');
  await expect(dialog.getByText(/7 people · gross/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Post payroll' }).click();
  await expect(page.getByText(/Payroll for Jan 2027 posted/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('tbody tr')).toHaveCount(before + 1);
});

test('exports entries to Excel', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('link', { name: 'Entries' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/^entries-.*\.xlsx$/);
});

test('imports a bank statement and matches a line', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await page.getByRole('button', { name: 'Reconcile' }).first().click();
  await expect(page.getByRole('heading', { name: /Reconcile/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Match' }).first()).toBeVisible();
  const remaining = await page.getByRole('button', { name: 'Match' }).count();
  await page.getByRole('button', { name: 'Match' }).first().click();
  await expect(page.getByText('Matched')).toBeVisible();
  await expect.poll(async () => page.getByRole('button', { name: 'Match' }).count()).toBeLessThan(remaining);

  await page.getByRole('button', { name: 'Import statement (CSV)' }).click();
  const csv = 'Date,Narration,Debit,Credit,Balance\n05/10/2026,SERVICE CHARGE,350.00,,\n06/10/2026,E2E CLIENT DEPOSIT,,125000.00,\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText('2 lines ready')).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 lines' }).click();
  await expect(page.getByText(/Imported 2 line/)).toBeVisible();
  await expect(page.getByText('E2E CLIENT DEPOSIT')).toBeVisible();
});
