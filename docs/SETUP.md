# Setting up AptoCAD Finance

This takes about **20 minutes** the first time. You need: a Supabase account (free to start), the
Windows installer, and the email addresses of the people who will use the app.

> Just want to look around first? Install the app and click **Try the demo**. Demo data stays on that PC.

---

## 1. Create the company database (Supabase)

1. Go to <https://supabase.com>, sign in, and click **New project**.
   - **Name:** `aptocad-finance`
   - **Database password:** generate a strong one and keep it in a password manager (you will rarely need it).
   - **Region:** choose the closest to Sri Lanka (for example *South Asia (Mumbai)* or *Southeast Asia (Singapore)*).
2. Wait for the project to finish setting up (1–2 minutes).
3. Open **SQL Editor → New query**, paste the whole of [`supabase/setup.sql`](../supabase/setup.sql), and click **Run**.
   You should see *Success. No rows returned.* This creates every table, the security rules, the
   audit trail, the default departments (Civil, Mechanical, Corporate / Shared) and the chart of
   accounts from your Excel "Lists" sheet.
   - Developers can instead use the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.
4. **Authentication → Sign In / Providers → Email**: keep *Email* enabled. Password minimum length: 8.
   *Confirm email* can stay on (people click a link once) or off (faster set-up).
5. Copy the two values the app needs:
   - **Project URL** — click **Connect** at the top of the project page, or open **Project Settings → Data API**.
     It looks like `https://abcdefghijklmnop.supabase.co` (the letters are your project ID, also visible in the
     browser address bar: `supabase.com/dashboard/project/abcdefghijklmnop`).
   - **Publishable key** — **Project Settings → API Keys → Publishable key** (starts with `sb_publishable_`).
     If there is none yet, click *Create new API keys*. The legacy **anon** key also works, but Supabase is
     retiring legacy keys by the end of 2026, so prefer the publishable key.
   - **Never** use a **secret** (`sb_secret_…`) or **service_role** key in the app — those bypass the security rules.

### Plan and backups

The free plan is fine for trying things out. For the real company books, use a paid plan so the project
is never paused for inactivity and **daily backups** are kept (Database → Backups). Also export the
**Accountant's pack** (Reports) at every month-end and keep it on OneDrive or Google Drive as an offline copy.

---

## 2. Install the app on each Windows PC

1. Download the installer:
   - from a GitHub **Release** (`AptoCAD Finance_1.x.x_x64-setup.exe`), or
   - from the latest successful **CI** run → *Artifacts* → `AptoCAD-Finance-Windows-installer`.
2. Run it. It installs for the current Windows user (no admin rights needed) and adds a Start-menu shortcut.
   - If Windows SmartScreen says *"Windows protected your PC"*, click **More info → Run anyway**. This
     appears until the installer is code-signed (see section 6).
   - Windows 10/11 already include the WebView2 runtime the app uses; the installer adds it if missing.
3. Open **AptoCAD Finance** → **Connect the company database** → paste the Project URL and anon key → **Connect**.

---

## 3. Create the users

1. **You first.** On the sign-in screen choose **Create account** and use your work email.
   **The first account created becomes the Admin.**
2. Ask the **Mechanical director** (and anyone else) to install the app, connect, and **Create account**.
   They will see *"Waiting for approval"*.
3. In **Settings → Users**, give each person a role:

   | Role | Typical person | Can do |
   |---|---|---|
   | Admin | Company owner | Everything, incl. users, settings, month lock, import |
   | Department director | Civil / Mechanical directors | Record entries, payroll, invoices, budgets for **their** department and shared costs; pay only from their own department's accounts; see all reports |
   | Bookkeeper | Office staff | Record entries for every department |
   | Read-only (accountant) | External accountant | See and export everything, change nothing |

   The directors' roles are enforced **by the database**, not just the app.

---

## 4. Enter your starting position

Choose one:

- **Import the Excel tracker:** Settings → Import &amp; export → *Choose workbook…* → select your
  *AptoCAD Department Finance Tracker* file. You will see a preview with any problem rows (for example
  missing exchange rates) before anything is saved. Importing the same file again never duplicates rows.
- **Start fresh:** Accounts → *Add account* for each bank, Upwork, Payoneer and cash account (owned by the
  right department), then *Set opening balance* with the statement balance on your start date
  (e.g. 31 March 2027 for a 1 April 2027 go-live).

Then add staff (Contacts → Staff) with their basic salary and EPF number, and your open projects.

Check **Settings → Payroll &amp; tax** with your accountant (EPF/ETF rates, APIT bands, tax and SSCL/VAT thresholds).

---

## 5. Go-live checklist

- [ ] Every account's opening balance matches the bank / Payoneer / Upwork statement on the start date
- [ ] Both directors can sign in; each can only record for their own department
- [ ] Reports → Monthly summary matches the Excel *Monthly Summary* for the parallel-run months
- [ ] Month lock set for any months already closed
- [ ] Supabase backups switched on; first Accountant's pack exported

---

## 6. Optional: pre-configured installers, automatic updates, code signing

These are for whoever manages the GitHub repository.

**Pre-configured installers** (no need to paste the URL/key on each PC): in GitHub → *Settings → Secrets and
variables → Actions → Variables* add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Release builds then
connect automatically. (The anon key is designed to be public; the database security rules protect the data.)

**Automatic updates:**

1. On any PC with Node.js: `npx @tauri-apps/cli signer generate -w aptocad-updater.key` (choose a password).
2. GitHub → *Secrets*: add `TAURI_SIGNING_PRIVATE_KEY` (the content of `aptocad-updater.key`) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. *Variables*: add `TAURI_UPDATER_PUBKEY` (the content of `aptocad-updater.key.pub`).
3. Create a release: tag the commit `v1.0.1` and push the tag (or run the *Release* workflow). The workflow
   builds the installer and a signed update, and creates a **draft** GitHub release — review and publish it.
4. Installed apps check for updates a few seconds after starting (and from the user menu → *Check for
   updates*) and offer **Install &amp; restart**.

Keep the private key safe: without it you cannot publish updates to already-installed apps.

**Code signing** (removes the SmartScreen warning): buy an OV code-signing certificate or use Microsoft's
Azure Trusted Signing, then add the signing step to `.github/workflows/release.yml` as described in the
[Tauri Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Waiting for approval" after sign-up | An admin must assign a role in Settings → Users |
| "You can only record entries for your own department" | Directors record for their department or Corporate / Shared; ask the admin for a Bookkeeper role if needed |
| "The books are locked up to …" | An admin can unlock in Settings → Month lock |
| No exchange rate appears | The PC is offline or the rate service is down — type the rate from the bank advice |
| Other director's entries don't appear | They appear within a second when Supabase Realtime is on; otherwise switch pages or restart the app |
| Wrong database | User menu → *Change database connection* |
