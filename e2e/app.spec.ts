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
  await expect(dialog.getByText(/Choose a category for each amount/)).toBeVisible();
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

test('downloads an invoice PDF and a payslip PDF', async ({ page }) => {
  await startDemo(page);
  await page.getByRole('link', { name: 'Invoices & quotes' }).click();
  await page.getByRole('button', { name: /Actions for INV-/ }).first().click();
  const invoicePdf = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download PDF' }).click();
  expect((await invoicePdf).suggestedFilename()).toMatch(/^INV-\d{4}-\d{4}\.pdf$/);

  await page.getByRole('link', { name: 'Payroll' }).click();
  await page.getByRole('cell', { name: /2026/ }).first().click();
  const payslip = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Payslip' }).first().click();
  expect((await payslip).suggestedFilename()).toMatch(/^payslip-.*\.pdf$/);
});

test("builds the accountant's pack", async ({ page }) => {
  await startDemo(page);
  await page.goto('/#/reports?tab=pack');
  await expect(page.getByText('Balances ✓')).toBeVisible();
  const pack = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download accountant pack/ }).click();
  expect((await pack).suggestedFilename()).toMatch(/^AptoCAD-accountant-pack-.*\.xlsx$/);
});

test('connect screen fixes a pasted API URL and tests the key before saving', async ({ page }) => {
  const ref = 'abcdefghijklmnopqrst';
  let keyOk = false;
  await page.route(`https://${ref}.supabase.co/auth/v1/settings`, (route) =>
    keyOk
      ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ external: { email: true }, disable_signup: false }) })
      : route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ message: 'Invalid API key' }) }),
  );
  await page.goto('/');
  await page.getByLabel('Supabase project URL').fill(`https://${ref}.supabase.co/rest/v1/`);
  await expect(page.getByText(`Will connect to https://${ref}.supabase.co`)).toBeVisible();
  await page.getByLabel('Publishable key').fill('sb_secret_0123456789abcdefghij');
  await expect(page.getByText(/This is a secret key/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled();

  await page.getByLabel('Publishable key').fill('sb_publishable_0123456789abcdefghij');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Supabase did not accept the key')).toBeVisible();

  keyOk = true;
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('aptocad-finance-connection'));
  expect(JSON.parse(saved ?? '{}').url).toBe(`https://${ref}.supabase.co`);
});

// A stand-in for Supabase Auth, enough to drive the sign-up, confirm and reset screens.
async function fakeSupabase(page: Page) {
  const ref = 'abcdefghijklmnopqrst';
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'ishara@aptocad.lk', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', exp })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user };
  await page.addInitScript((url) => {
    localStorage.setItem('aptocad-finance-connection', JSON.stringify({ url, anonKey: 'sb_publishable_0123456789abcdefghij' }));
    localStorage.setItem('aptocad-finance-mode', 'supabase');
  }, `https://${ref}.supabase.co`);
  await page.route(`https://${ref}.supabase.co/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    calls.push({ method: req.method(), path, body });
    const json = (status: number, data: unknown) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    if (path === '/auth/v1/signup') return json(200, { ...user, confirmation_sent_at: '2026-10-01T00:00:00Z' });
    if (path === '/auth/v1/token') return json(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
    if (path === '/auth/v1/verify') return body.token === '123456' ? json(200, session) : json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    if (path === '/auth/v1/recover') return json(200, {});
    if (path === '/auth/v1/user') return json(200, user);
    if (path === '/rest/v1/members') return json(200, []);
    return json(404, { message: 'not mocked' });
  });
  return calls;
}

test('new account is confirmed with the code from the email', async ({ page }) => {
  const calls = await fakeSupabase(page);
  await page.goto('/');
  await page.getByRole('radio', { name: 'Create account' }).click();
  await page.getByLabel('Full name').fill('Ishara Perera');
  await page.getByLabel('Email').fill('ishara@aptocad.lk');
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();

  await page.getByLabel('Code from the email').fill('111111');
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByText(/code is wrong or has expired/)).toBeVisible();

  await page.getByLabel('Code from the email').fill('123456');
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
  expect(calls.filter((c) => c.path === '/auth/v1/verify').at(-1)?.body).toMatchObject({ email: 'ishara@aptocad.lk', token: '123456', type: 'email' });
});

test('unconfirmed sign-in asks for the code, and a forgotten password is reset by code', async ({ page }) => {
  const calls = await fakeSupabase(page);
  await page.goto('/');
  await page.getByLabel('Email').fill('ishara@aptocad.lk');
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await expect(page.getByText(/not confirmed yet/)).toBeVisible();

  await page.getByRole('button', { name: 'Back to sign in' }).click();
  await page.getByRole('radio', { name: 'Forgot password' }).click();
  await page.getByLabel('Email').fill('ishara@aptocad.lk');
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await expect(page.getByRole('heading', { name: 'Set a new password' })).toBeVisible();
  await page.getByLabel('Code from the email').fill('123456');
  await page.getByLabel('New password').fill('another-long-password');
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for approval' })).toBeVisible();
  expect(calls.find((c) => c.path === '/auth/v1/verify')?.body).toMatchObject({ token: '123456', type: 'recovery' });
  await expect.poll(() => calls.find((c) => c.method === 'PUT' && c.path === '/auth/v1/user')?.body.password).toBe('another-long-password');
});
