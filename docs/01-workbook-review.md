# 1. Review of the current Excel tracker

**File reviewed:** `AptoCAD_Department_Finance_Tracker_COMPATIBLE.xlsx` (last modified 22 Aug 2026)
**Status:** Template only. It has no transactions yet; every register holds formulas and dropdowns but no data.

The workbook is well designed for a spreadsheet. It already encodes the right business rules
(department profit centres, transfers excluded from profit, payroll recorded once, LKR reporting with
original currency kept). The app should **keep these rules and enforce them automatically** instead of
relying on people to remember them.

---

## 1.1 What each sheet does

| Sheet | Purpose | Capacity | Key logic |
|---|---|---|---|
| **START HERE** | House rules for Civil, Mechanical, Corporate/Shared, transfers, payroll, base currency | – | Text only |
| **Dashboard** | Company KPIs plus a panel per department (Civil, Mechanical) | – | Links to Monthly Summary and Accounts |
| **Monthly Summary** | 12 months × (Civil, Mechanical, Corporate, Company) revenue, cost, payroll, profit, margin, transfer net, cash movement | 1 year (`B3` = Report Year) | `SUMIFS` by month-end date, department, status ≠ Void |
| **Income** | Client receipts: date, department, project, client, category, channel, account, method, currency, amount, FX, LKR, invoice ref, status, reconciled | 300 rows | `Amount LKR = Original × FX`; Void → 0 |
| **Expenses** | Bills and costs, including Corporate/Shared | 400 rows | Auto-flags **Direct Project Cost** for 5 categories when a Project ID is set |
| **Payroll** | Gross pay, employer extras, net paid per person | 300 rows | `Total cost = Gross + Employer extras` |
| **Transfers** | Money moved between Civil and Mechanical | 150 rows | Control check flags same-department transfers |
| **Projects** | Project register and profitability | 100 rows | Revenue − direct expenses − allocated payroll = contribution and margin % |
| **Accounts** | Bank, platform and cash accounts, each owned by a department | 50 rows | `Balance = Opening + In − Out − Payroll ± Transfers` |
| **Lists** | Dropdown sources: departments, currencies (LKR, USD, CAD, GBP, EUR), channels, methods, statuses, 20 expense categories, 7 revenue categories | – | Used by data validation |

**Design cues worth reusing:** the brand accent red `#EA0200` and charcoal `#262626` used on the
Dashboard headers, LKR number format with negatives in red brackets, and ISO dates (`yyyy-mm-dd`).

---

## 1.2 Business rules the app must keep

These become **validation rules and automatic behaviour** in the app:

1. **Two operating departments, Civil and Mechanical**, each measured independently. Each has a
   director. Only operating departments earn revenue.
2. **Corporate / Shared** is used only for real company-level costs. It appears in consolidated results.
3. **Department transfers are recorded once** and never count as revenue or expense. They change
   department cash but not company profit.
4. **Payroll is recorded only in Payroll**, never again in Expenses.
5. **LKR is the reporting currency**, and every transaction keeps its original currency, amount and FX rate.
6. **Void instead of delete.** Voided records stay visible and are excluded from all totals.
7. **Project profitability** = revenue − direct project costs − allocated payroll. Direct costs are
   PE/EOR review and stamp, subcontract drafting, engineering calculation support, survey and other
   consultants, and permit or submission costs.
8. **Every account belongs to one department** (or Corporate), so each department has its own cash balance.
9. **Reconciled flag** on every money movement.

---

## 1.3 Issues found

Ranked by impact on the accuracy of the numbers.

### High impact

| # | Issue | Where | Why it matters |
|---|---|---|---|
| H1 | **You can't move money between two accounts in the same department**, for example a Payoneer USD withdrawal to a local LKR bank account. | `Transfers` accepts only `Civil, Mechanical` and flags a same-department transfer as `ERROR` | Platform balances (Upwork, Payoneer) keep growing while bank balances go negative after payroll, so account balances drift from reality. FX gain or loss on conversion is also never recorded. |
| H2 | **A missing FX rate silently drops the transaction from every total.** | `Income!O`, `Expenses!P`, `Transfers!L` return `""` when FX is blank. `SUMIFS` ignores it. | Revenue or cost is under-reported with no warning. LKR entries also need someone to type `1` as the rate. |
| H3 | **Foreign-currency account balances exist only in LKR**, at the rates of past transactions. | `Accounts!K` | You can't reconcile a USD Payoneer balance against the Payoneer statement, and there's no unrealised FX view. |
| H4 | **Payroll cash and payroll cost are mixed up.** | `Accounts!H` uses total cost (gross + employer extras) on the pay date | The money that actually leaves on payday is *net pay*. EPF, ETF and APIT are paid later. Net Paid (`Payroll!K`) isn't used anywhere, and deductions (EPF 8%, APIT) aren't broken down. |
| H5 | **"Pending" counts as received.** | All `SUMIFS` exclude only `Void` | The dashboard shows revenue and cash that haven't arrived yet, so the cash balance is overstated. |

### Medium impact

| # | Issue | Where | Why it matters |
|---|---|---|---|
| M1 | **Fixed row capacity** (300 / 400 / 300 / 150 / 100 / 50 rows) | All registers | Rows past the limit have no formulas or dropdowns, so totals quietly stop including new data. |
| M2 | **Records are linked by typed text**, not by stable IDs. Record IDs are typed by hand. | `Accounts!B` (name), Project ID, Income/Expense ID | Renaming an account breaks every link to it. Duplicate project or record IDs aren't blocked. |
| M3 | **The Direct Project Cost rule is hard-coded** as five category names inside a formula. | `Expenses!H` | Renaming a category in `Lists` silently reclassifies costs and changes project margins. |
| M4 | **Calendar-year reporting only.** | `Monthly Summary!B3` | Sri Lanka's year of assessment runs **1 April – 31 March**. The dashboard labels say "YTD" but sum the whole calendar year, including future-dated entries. |
| M5 | **Corporate / Shared costs are never allocated** to departments. | Dashboard | Department profits look better than their fully loaded profit. |
| M6 | **Upwork fees need two manual entries** (gross income plus a "Upwork / Platform Fees" expense). | Income + Expenses | Error-prone. The Upwork fee has varied by contract (0–15%) since May 2025. |
| M7 | **No protection and no audit trail.** | All sheets | Formulas can be overwritten by accident. There's no record of who changed what or when. |

### Low impact / missing features

- **L1** No charts or conditional formatting. The dashboard shows numbers only.
- **L2** `Original Amount` uses the `#,##0` format, which hides cents on USD, GBP and EUR amounts.
- **L3** No receipt or invoice attachments, only a reference text field.
- **L4** Transfer accounts aren't checked against the departments involved, and the control check only warns.
- **L5** No budgets, invoices/receivables, bills due, recurring costs or tax provisions (15% income tax, SSCL).

---

## 1.4 How the app fixes each issue

| Excel pain | App behaviour |
|---|---|
| H1 same-department moves | A **Move money** screen for any account-to-account move (same or different department, same or different currency), with *amount sent* and *amount received*. FX gain or loss is calculated automatically. |
| H2 blank FX | FX is **required** for non-LKR entries and pre-filled from the day's CBSL rate. LKR entries skip FX. Save is blocked until the entry is complete. |
| H3 LKR-only balances | Balances are kept in the **account's own currency** plus an LKR value at today's rate, with an unrealised FX line. |
| H4 payroll cash vs cost | A **payroll run** records gross, employee deductions (EPF 8%, APIT), employer contributions (EPF 12%, ETF 3%) and net pay. Net pay leaves the bank on payday; statutory amounts become liabilities until they're paid. |
| H5 pending | "Expected" money (invoices and bills) is kept separate from "Received / Paid". Dashboards show **actual cash** and **expected** separately. |
| M1 capacity | A database with no row limits. |
| M2 text keys | Internal unique IDs. Names can be renamed safely. Numbers are auto-generated (`INC-2026-0001`, `CIV-P-0012`). |
| M3 hard-coded categories | Categories have an **"Is direct project cost"** setting in Settings. |
| M4 year | You pick the **financial year (April–March)** or calendar year, plus custom date ranges and a true year-to-date. |
| M5 allocation | Optional **allocation rules** for shared costs (by revenue share, headcount or fixed %), shown as a separate "fully loaded" view. |
| M6 Upwork | One **"Platform payout"** entry splits gross, fee and net, and Upwork/Payoneer CSV exports can be imported. |
| M7 protection | Calculations can't be edited, every change is written to an **audit log**, and roles control who can see or edit each department. **Month lock** stops changes to closed periods. |
| L1–L5 | Charts, attachments, budgets, invoices, recurring bills and tax provisions (see the roadmap). |
