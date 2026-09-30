# 2. Market & technology research

Research date: **30 September 2026**. Sources are listed at the end of this file.

---

## 2.1 Existing income and expense tools

| Product | Type | Strengths to learn from | Why it isn't a perfect fit for AptoCAD |
|---|---|---|---|
| **QuickBooks Online** | Cloud, subscription | Full stack: income/expense, invoicing, bill pay, receipt capture, reports. AI categorisation. **Class/Location tracking** gives a P&L by department. | Monthly per-user cost. Assumes accounting knowledge. Class tracking only on higher tiers. Not built around LKR or Sri Lankan payroll. |
| **Xero** | Cloud, subscription | Bank reconciliation, automatic invoicing. **Tracking categories** (up to 2 dimensions, 100 options each) for department and project reporting. | Same cost and complexity trade-offs. Limited to two tracking dimensions. |
| **Zoho Books** | Cloud, freemium | Custom dashboards, recurring transactions, payment reminders, user roles. | Cloud only. General-purpose setup. |
| **FreshBooks** | Cloud | Invoice-first, with time tracking and billable expenses for service firms. | Built for freelancers more than two-department companies. |
| **Expensify / Ramp** | Spend management | Very fast receipt capture, cards, live spend alerts. | Covers spending only, not a full income picture. |
| **Manager.io** | **Free desktop (Windows/Mac/Linux)** plus cloud | Offline, data stays local. Multi-currency, bank reconciliation, payroll, modular features you switch on. | Accounting-style UI with a learning curve. No department-transfer logic. |
| **GnuCash** | Free, open-source desktop | Double-entry, multi-currency, scheduled transactions. | Dated UI, aimed at people who understand bookkeeping. |
| **Akaunting** | Open-source web (Laravel) | Double-entry under a friendly UI, multi-currency with automatic rates, reconciliation, app marketplace. | Needs a web server. Payroll is a paid add-on. |
| **Money Manager Ex** | Free desktop | Simple, fast personal finance. | Personal, not company, finance. |

### What the best tools have in common

1. **Fast capture.** Recording an expense takes seconds: a receipt photo or drag-and-drop, smart defaults, remembered vendors.
2. **Automatic categorisation** using rules or AI ("Upwork → Platform fees").
3. **Bank and platform imports** plus a **reconciliation** screen that matches statement lines to records.
4. **Reporting dimensions** (Xero tracking categories, QuickBooks classes) for **P&L by department and by project**. This is exactly AptoCAD's Civil/Mechanical model.
5. **Multi-currency with automatic rates**, plus realised and unrealised FX.
6. **Recurring transactions** for subscriptions, rent and internet.
7. **Visual dashboards** that suit a quick check or a deep review.
8. **Roles and permissions** covering who can add, see or approve records.
9. **Accountant export** to Excel or PDF, with clean categories for tax filing.
10. **Double-entry under the hood** (Akaunting, Manager.io), so balances never drift, while the UI stays in plain language.

### Where AptoCAD's needs differ (our advantage)

No off-the-shelf tool handles all of these without heavy setup and accounting knowledge:

- **Department-as-profit-centre** with transfers automatically excluded from company profit.
- **LKR reporting** with **USD/CAD/GBP/EUR** client income arriving through **Upwork, Payoneer and direct transfers**.
- **Platform payouts** (gross, variable fee, net), then a USD→LKR conversion, then a local bank deposit.
- **Engineering project profitability** (PE stamp, subcontract drafting, permits as direct costs).
- **Sri Lankan payroll** (EPF, ETF, APIT) and **Sri Lankan tax context** (service-export income tax, SSCL, VAT thresholds).

So a **purpose-built, opinionated app** with a consumer-grade UI is justified, as long as it stays small and focused.

---

## 2.2 Sri Lanka context that shapes features

> ⚠️ Tax rules change often. Every rate and threshold below must be a **setting in the app, not hard-coded**,
> and should be confirmed with AptoCAD's accountant before go-live.

| Topic | Current understanding (Sept 2026) | Feature implication |
|---|---|---|
| **Service-export income tax** | Since 1 April 2025, income from services exported to foreign clients is taxed (**15%** for companies, **max 15%** for individuals) when received in foreign currency and **remitted through a bank in Sri Lanka**. | Track **remittance evidence** (bank credit advice) per foreign receipt. Show a **tax provision** estimate on the dashboard. Keep the tax rate configurable. |
| **Year of assessment** | 1 April – 31 March | Reports default to the **April–March financial year**, with calendar year as an option. |
| **EPF / ETF** | Employee EPF **8%**, employer EPF **12%**, employer ETF **3%** | Payroll run with automatic statutory lines and due-date reminders. |
| **APIT** | Monthly tax-free threshold **LKR 150,000** (LKR 1.8 M/year) since 1 April 2025, then 6%–36% bands | APIT table as editable settings (Phase 3). |
| **SSCL** | **2.5%** on turnover. Registration threshold cut to **LKR 9 M/quarter or LKR 36 M/year from 1 July 2026** (SSCL Amendment Act No. 10 of 2026). | Turnover monitor with a threshold alert. |
| **VAT** | Registration threshold kept at **LKR 60 M/year** (a proposed cut to LKR 36 M was dropped). | Turnover monitor. VAT fields hidden until switched on. |
| **FX rates** | CBSL publishes daily rates for about 55 currencies. Free APIs expose them, for example Frankfurter with `providers=CBSL`. | Auto-fill the daily rate, let users override it with the actual bank rate, and cache rates offline. |
| **Upwork fees** | Since 1 May 2025, a **variable 0–15%** fee per contract (typically around 10%). | Store the fee per payout, never as a fixed %, and import Upwork transaction CSVs. |

---

## 2.3 Windows technology options

| Option | Look & feel | Installer size / RAM | Dev speed & ecosystem | Future reach | Notes |
|---|---|---|---|---|---|
| **Tauri 2 + React + TypeScript** ✅ | Modern web UI (Tailwind, shadcn/ui), easy to make polished | **~3–10 MB**, ~30–50 MB idle RAM (uses Windows' built-in WebView2) | Largest UI/chart/table ecosystem. AI coding assistants are strongest here. | Windows now. macOS, Linux, iOS and Android are possible later. | Rust only for a thin shell. Business logic can stay in TypeScript. |
| **.NET 10 (LTS) + WinUI 3** | Most native Windows 11 look (Fluent, Mica) | Medium | Good for C# developers. The XAML designer lags and the component ecosystem is smaller. | Windows only | Windows App SDK 2.x reached stable in 2026. .NET 10 is supported to Nov 2028. |
| **.NET 10 + WPF (+ WPF-UI Fluent theme)** | Classic, can be themed to look modern | Medium | Very mature for data-entry apps | Windows only | A safe enterprise choice, but ageing technology. |
| **Avalonia** | Custom-drawn, looks identical everywhere | Medium | Good, smaller community | Cross-platform | Good if C# and cross-platform both matter. |
| **Electron** | Same web UI benefits as Tauri | **80–250 MB**, higher RAM | Huge ecosystem | Cross-platform | Heavier than needed for this app. |

**Recommendation: Tauri 2 + React + TypeScript + SQLite.** The full rationale is in the roadmap
(section 3.5). If the developer strongly prefers C#, **.NET 10 + WinUI 3** is the best alternative, and the
roadmap phases stay the same.

---

## 2.4 UX findings for finance apps

- Put a **summary graph first, detail one click away**. Dashboards should work for a 10-second glance and a 10-minute review.
- Use **plain language, not accounting jargon**: "Money in", "Money out", "Move money", "Pay staff".
- Use **consistent colour meaning**: green = in, red = out, grey = transfers, amber = needs attention.
- Keep **capture friction near zero**: one shortcut to add, remembered defaults, drag a receipt PDF onto the window.
- Use **gentle nudges, not errors**: "3 expenses have no receipt", "Payoneer not reconciled for 32 days".
- Make it **trustworthy**: nothing is ever deleted (void and history), and totals always tie back to their source records.

---

## Sources

- Expensify: [Best business expense tracking app 2026](https://use.expensify.com/resource-center/guides/best-business-expense-tracking-app)
- BillingNow: [Best expense tracking software for SMBs 2026](https://www.billingnow.com/blog/post/best-expense-tracking-software-2026-smb-reviews-pricing)
- BigTime: [Business expense tracker 2026 ranking](https://www.bigtime.net/blogs/business-expense-tracker/)
- Manager.io: [manager.io](https://manager.io) · [Capterra listing](https://www.capterra.com/p/80270/Manager/)
- Akaunting: [OpenAlternative – Akaunting](https://openalternative.co/akaunting)
- GnuCash vs Zoho Books: [Capterra comparison](https://www.capterra.ca/compare/125092/134507/gnucash/vs/zoho-books) · [AlternativeTo – Zoho Books](https://www.alternativeto.net/software/zoho-books/)
- Department reporting: [Bookkeeper360 – QBO classes & Xero tracking](https://bookkeeper360.com/blog/class-tracking-in-quickbooks-online-and-tracking-categories-in-xero/) · [Accounting Prose – Xero tracking categories](https://blog.accountingprose.com/xero-tracking-categories)
- Frameworks: [TeamDev – Top 7 desktop app frameworks in 2026](https://teamdev.com/mobrowser/blog/top-7-desktop-app-frameworks-in-2026/) · [Avalonia vs WinUI 3](https://avaloniaui.net/winui-compare) · [PkgPulse – Electron vs Tauri 2026](https://www.pkgpulse.com/guides/electron-vs-tauri-2026) · [Noqta – Tauri 2 apps 10× smaller](https://noqta.tn/en/blog/tauri-2-desktop-apps-rust-web-technologies-2026)
- .NET / Windows App SDK: [State of .NET 2026](https://devnewsletter.com/p/state-of-dot-net-2026/) · [Microsoft.WindowsAppSDK on NuGet](https://www.nuget.org/packages/Microsoft.WindowsAppSDK/1.8.260416003) · [Velopack docs](https://docs.velopack.io/integrating/overview)
- Sri Lanka payroll: [HiveDesk – Sri Lanka compliance](https://www.hivedesk.com/compliance/sri-lanka) · [Pebl – Payroll tax in Sri Lanka](https://hellopebl.com/resources/blog/payroll-tax-in-sri-lanka)
- Service-export tax: [AsiaNews – Colombo imposes a new tax on service exports](https://www.asianews.it/news-en/Colombo-imposes-a-new-tax-on-service-exports-62621.html) · [TaxAdvisor.lk – Service exporters](https://www.taxadvisor.lk/article/sei) · [Inland Revenue (Amendment) Act No. 02 of 2025](https://documents.gov.lk/view/acts/2025/3/02-2025_E.pdf)
- VAT / SSCL: [KPMG – Sri Lanka amendments to VAT Act (Jul 2026)](https://kpmg.com/us/en/taxnewsflash/news/2026/07/tnf-sri-lanka-amendments-to-vat-act.html) · [KPMG – SSCL (Amendment) Act No. 10 of 2026](https://assets.kpmg.com/content/dam/kpmgsites/lk/pdf/kpmg-tax-news/2026/april/Social_Security_Contribution_Levy_(Amendment)_Act_No_10_of_2026.pdf) · [TaxAdvisor.lk – SSCL threshold timeline](https://www.taxadvisor.lk/article/tc1) · [LookupTax – Sri Lanka VAT](https://lookuptax.com/docs/country/sri-lanka-vat-guidelines-indirect-tax)
- FX rates: [Frankfurter – CBSL provider](https://frankfurter.dev/providers/cbsl/) · [AllRatesToday – CBSL API](https://allratestoday.com/blog/cbsl-exchange-rate-api/)
- Upwork fees: [GoLance – Upwork fees explained 2026](https://golance.com/blogs/upwork-fees-explained-2026)
- UX: [Ramotion – Expense tracker UI/UX concept](https://www.ramotion.com/expense-tracker-app-ui-ux-design-concept/) · [WildnetEdge – Expense tracker app development](https://www.wildnetedge.com/blogs/expense-tracker-app-development-smart-money-management)
