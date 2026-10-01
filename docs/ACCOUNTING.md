# How AptoCAD Finance records things (accounting policies)

Written for the directors and the external accountant. It explains what every screen posts, so the
numbers can be trusted and audited.

## 1. Basis

- **Management accounts, cash basis.** Income counts when money is received (cleared into a bank or
  platform account); costs count when paid. Invoices and bills track what is owed but do not change
  profit until paid. This matches the Excel tracker. The statutory accounts (SLFRS for SMEs, accrual)
  are prepared by the accountant from the exports.
- **Reporting currency: LKR.** Every line keeps its original currency amount and the rate used.
- **Financial year: 1 April – 31 March** (Sri Lankan year of assessment), configurable.
- **Pending** entries (e.g. an Upwork payment still clearing) are excluded from profit and cash until
  marked cleared. **Void** entries remain on record with a reason and are excluded everywhere.

## 2. Double-entry under the hood

Each business event is one **entry** made of **lines** whose LKR amounts sum to exactly zero
(+ debit, − credit). Users fill in plain forms; the app writes the lines. The database refuses to save an
entry that does not balance or that breaks the rules below, so balances cannot drift.

| Screen | Lines written |
|---|---|
| Money in (with platform fee) | + account (net received) · + fee (cost) · − revenue (gross) |
| Money out (split categories) | + each cost category · − paying account |
| Move money (same currency) | − from account · + to account |
| Move money (USD → LKR) | − USD account at its **average carrying rate** · + LKR received · ± exchange gain/loss |
| Department transfer | − sender's account (sender's department) · + receiver's account (receiver's department) |
| Payroll (per person) | + gross salary · + employer EPF 12% · + ETF 3% · − EPF payable (8%+12%) · − ETF payable · − APIT payable · − bank (net pay) |
| Statutory payment | + EPF / ETF / APIT payable · − bank |
| Opening balance | + account · − Opening Balance Equity |
| Adjustment (admin/bookkeeper) | any balanced lines, LKR only |

## 3. Rules enforced (from the workbook's START HERE sheet)

1. Only **operating departments** (Civil, Mechanical) can record revenue.
2. **Corporate / Shared** holds genuine company-level costs; shown separately and, optionally,
   allocated to departments by revenue share or fixed % in a *fully loaded* view (never posted).
3. **Transfers never count as revenue or expense.** A transfer entry cannot contain income or cost
   lines, except transfer fees and exchange differences.
4. **Payroll only through Payroll.** Salary and employer-contribution categories cannot be used in Money out.
5. **LKR reporting with original currency and rate retained.** A foreign line without a valid rate is rejected
   (in the workbook such rows silently dropped out of the totals).
6. A money account belongs to one department; its lines always carry that department. Money may
   arrive in any account, but only leaves accounts of departments the user may write to.
7. **Month lock:** nothing dated on or before the locked date can be added, edited or voided.
8. **Audit trail:** every post, edit, void and master-data change is stored with before/after values and the user.

## 4. Foreign currency

- Income and costs use the rate on the transaction date (CBSL indicative rate suggested; the actual bank
  rate may be typed instead).
- Moving money out of a foreign account uses the account's **average carrying rate** (LKR book value ÷
  balance). The difference to the LKR actually received is the **realised exchange gain/loss**
  (category *Exchange Gain / Loss*, an operating expense; gains appear as negative expense).
- Balances are shown in each account's own currency and valued at today's rate; the difference to the
  LKR book value is shown as **unrealised** exchange difference (not posted).

## 5. Payroll (Sri Lanka)

- EPF employee 8%, employer 12%, ETF employer 3% on EPF-liable earnings (basic + EPF-liable allowances).
- APIT is estimated from monthly bands in Settings (tax-free LKR 150,000 per month from 1 April 2025,
  then 6% / 18% / 24% / 30% / 36%). The official IRD APIT table figure can be entered to override.
- Contractors are paid gross with no EPF, ETF or APIT.
- Cost to the department = gross + employer EPF + ETF, recognised on the pay date; net pay leaves the bank;
  EPF/ETF/APIT stay as liabilities until the statutory payment is recorded (EPF/ETF due by the end of the
  following month, APIT by the 15th — shown in *Needs attention*).

## 6. Projects

Project contribution = revenue − **direct project costs** − payroll allocated to the project, as in the
Excel *Projects* sheet. Which categories are direct costs is a setting (Settings → Categories), not a
hard-coded list. Other costs tagged to a project are shown separately.

## 7. Tax monitor (estimates only)

- Income tax provision = rate × operating profit for the financial year to date (15% for service
  exports from 1 April 2025, when proceeds are remitted through a Sri Lankan bank — keep bank credit advices).
- SSCL (2.5% on turnover) and VAT registration thresholds are compared with quarterly and rolling
  12-month revenue. SSCL thresholds change on 1 July 2026 (LKR 9 M per quarter / 36 M per year).
- All rates and thresholds are settings and **must be confirmed by the accountant**.

## 8. Accountant's pack

Reports → Accountant's pack produces one Excel workbook for a financial year: read-me, trial balance
(P&amp;L accounts for the year, balance-sheet accounts cumulative, earlier profit as *Retained profit
brought forward*), P&amp;L by department, monthly summary, general ledger (every line with rate and LKR
value), entries (including voided ones with reasons), payroll register, invoices and bills.
