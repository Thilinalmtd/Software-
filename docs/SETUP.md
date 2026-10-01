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
4. **Authentication settings.** The app is a desktop program, so it cannot receive the *links* in Supabase's
   standard emails — they open a web page (by default `http://localhost:3000`, which shows *"This site can't be
   reached"*). The app asks for the **code** from the email instead:
   - **Authentication → Sign In / Providers:** keep *Email* enabled, set the minimum password length to 8, and
     turn **Confirm email off** (recommended). Nobody can see anything until an admin gives them a role in the
     app, so confirming the address adds little — and Supabase's built-in email only delivers to people in your
     Supabase team, a few emails an hour, so a director's confirmation email may never arrive.
   - **Authentication → Emails → Templates** (older dashboards: *Email Templates*): open **Reset password** and
     replace the message body with the version below, so password resets work from the app. If you keep
     *Confirm email* on, do the same for **Confirm sign up** (change the heading to *Confirm your email*).

     ```html
     <h2>Reset your AptoCAD Finance password</h2>
     <p>Enter this code in the AptoCAD Finance app:</p>
     <p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
     <p>The code expires in one hour. If you did not ask for it, you can ignore this email.</p>
     ```
   - **Authentication → Emails → SMTP Settings** (recommended before go-live): connect the company mailbox or a
     sending service (for example Resend, Brevo or Zoho Mail). Without it, password-reset emails reach only
     members of your Supabase team, and only a few per hour.
   - *URL Configuration → Site URL* is not used by the app; you can leave it as it is.
5. Copy the two values the app needs:
   - **Project URL** — click **Connect** at the top of the project page, or open **Project Settings → Data API**.
     It looks like `https://abcdefghijklmnop.supabase.co` (the letters are your project ID, also visible in the
     browser address bar: `supabase.com/dashboard/project/abcdefghijklmnop`). Use only this address — nothing
     after `.supabase.co`. (The app trims extras such as `/rest/v1/`, and also accepts the dashboard address.)
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
3. Open **AptoCAD Finance** → **Connect the company database** → paste the Project URL and publishable key →
   **Connect**. The app checks both with Supabase before saving them and explains anything that is wrong.

---

## 3. Create the users

1. **You first.** On the sign-in screen choose **Create account** and use your work email.
   **The first account created becomes the Admin.** If *Confirm email* is on, the app asks for the code from the
   confirmation email (or, with Supabase's standard email, click the link once, ignore the page it opens, and sign in).
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
variables → Actions → Variables* add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (put the publishable key in
the latter). Release builds then connect automatically. (The publishable key is designed to be public; the database
security rules protect the data.)

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
| "Invalid path specified in request URL" when signing in or creating an account | The saved Project URL had a path after `.supabase.co` (usually `/rest/v1/`), so sign-in went to the database API instead of the sign-in service. Update the app (it now trims the path, including on a saved connection), or click *Use a different database* and paste only `https://<project-id>.supabase.co` |
| *"This site can't be reached — localhost refused to connect"* after clicking a link in a Supabase email | The link did its job — the email address **is** confirmed; only the web page it opens afterwards doesn't exist. Go back to the app and sign in. To avoid it, turn off *Confirm email* or use the code templates (section 1, step 4) |
| *"Supabase's built-in email only sends to members of the company's Supabase team"* or *"a few emails an hour"* | Turn off *Confirm email*, or set up SMTP (section 1, step 4) |
| A password-reset email has a link but no code | Update the **Reset password** email template (section 1, step 4) and use *Send a new code* |
| "Supabase did not accept the key" | Copy the **publishable** key again (Project Settings → API Keys) from the same project as the URL |
| "Could not reach …" / "not responding" | Check the PC is online; on the free plan a project pauses after a week without use — restore it from the Supabase dashboard |
| "Waiting for approval" after sign-up | An admin must assign a role in Settings → Users |
| "You can only record entries for your own department" | Directors record for their department or Corporate / Shared; ask the admin for a Bookkeeper role if needed |
| "The books are locked up to …" | An admin can unlock in Settings → Month lock |
| No exchange rate appears | The PC is offline or the rate service is down — type the rate from the bank advice |
| Other director's entries don't appear | They appear within a second when Supabase Realtime is on; otherwise switch pages or restart the app |
| Wrong database | User menu → *Change database connection* |
