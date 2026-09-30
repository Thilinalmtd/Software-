-- AptoCAD Finance — default data (generated from src/domain/defaults.ts; do not edit by hand)

insert into public.departments (code, name, is_operating, director_name, color, sort_order) values
  ('CIV', 'Civil', true, 'Thilina', '#2563EB', 1),
  ('MEC', 'Mechanical', true, 'Ishara Deshapriya', '#D97706', 2),
  ('CORP', 'Corporate / Shared', false, null, '#64748B', 3)
on conflict (code) do nothing;

insert into public.ledger_accounts (code, name, type, currency, category_group, system_key) values
  ('4010', 'Permit / Construction Drawings', 'income', null, 'revenue', null),
  ('4020', 'Civil / Structural Engineering Services', 'income', null, 'revenue', null),
  ('4030', 'Mechanical Engineering Services', 'income', null, 'revenue', null),
  ('4040', 'Plan Check Revisions', 'income', null, 'revenue', null),
  ('4050', 'CAD / Revit Drafting', 'income', null, 'revenue', null),
  ('4060', 'Consulting / Other Services', 'income', null, 'revenue', null),
  ('4070', 'Performance Bonus', 'income', null, 'revenue', null),
  ('4910', 'Interest Income', 'income', null, 'other_income', null),
  ('4990', 'Other Income', 'income', null, 'other_income', null),
  ('5010', 'PE / EOR Review & Stamp', 'expense', null, 'direct_cost', null),
  ('5020', 'Subcontract Drafting', 'expense', null, 'direct_cost', null),
  ('5030', 'Engineering Calculation Support', 'expense', null, 'direct_cost', null),
  ('5040', 'Survey / Civil / Other Consultant', 'expense', null, 'direct_cost', null),
  ('5050', 'Project Permit / Submission Cost', 'expense', null, 'direct_cost', null),
  ('6010', 'Software & Subscriptions', 'expense', null, 'operating', null),
  ('6020', 'Internet & Phone', 'expense', null, 'operating', null),
  ('6030', 'Upwork / Platform Fees', 'expense', null, 'operating', 'platform_fees'),
  ('6040', 'Bank / FX / Transfer Fees', 'expense', null, 'operating', 'bank_fees'),
  ('6045', 'Exchange Gain / Loss', 'expense', null, 'operating', 'fx_difference'),
  ('6050', 'Advertising & Marketing', 'expense', null, 'operating', null),
  ('6060', 'Recruitment', 'expense', null, 'operating', null),
  ('6070', 'Professional Memberships', 'expense', null, 'operating', null),
  ('6080', 'Accounting / Legal / Corporate', 'expense', null, 'operating', null),
  ('6090', 'Office & Administration', 'expense', null, 'operating', null),
  ('6100', 'Equipment / Computers', 'expense', null, 'operating', null),
  ('6110', 'Training / Education', 'expense', null, 'operating', null),
  ('6120', 'Travel / Transport', 'expense', null, 'operating', null),
  ('6130', 'Taxes & Government Fees', 'expense', null, 'operating', null),
  ('6140', 'Utilities', 'expense', null, 'operating', null),
  ('6990', 'Other Operating Expense', 'expense', null, 'operating', null),
  ('7010', 'Salaries & Wages', 'expense', null, 'payroll', 'salaries'),
  ('7020', 'Employer EPF (12%)', 'expense', null, 'payroll', 'employer_epf'),
  ('7030', 'Employer ETF (3%)', 'expense', null, 'payroll', 'employer_etf'),
  ('8010', 'Income Tax Expense', 'expense', null, 'income_tax', 'income_tax_expense'),
  ('2110', 'EPF Payable', 'liability', 'LKR', null, 'epf_payable'),
  ('2120', 'ETF Payable', 'liability', 'LKR', null, 'etf_payable'),
  ('2130', 'APIT Payable', 'liability', 'LKR', null, 'apit_payable'),
  ('2140', 'Other Payroll Deductions Payable', 'liability', 'LKR', null, 'other_deductions_payable'),
  ('3010', 'Opening Balance Equity', 'equity', 'LKR', null, 'opening_equity')
on conflict (code) do nothing;

insert into public.company_settings (id, data) values
  (1, '{
  "company_name": "AptoCAD Engineering",
  "base_currency": "LKR",
  "fy_start_month": 4,
  "address": null,
  "tax_id": null,
  "invoice_footer": "Thank you for your business.",
  "currencies": [
    "LKR",
    "USD",
    "CAD",
    "GBP",
    "EUR",
    "AUD"
  ],
  "payroll": {
    "employee_epf_pct": 8,
    "employer_epf_pct": 12,
    "employer_etf_pct": 3,
    "apit_monthly_relief_minor": 15000000,
    "apit_bands": [
      {
        "width_minor": 8333333,
        "rate_pct": 6
      },
      {
        "width_minor": 4166667,
        "rate_pct": 18
      },
      {
        "width_minor": 4166667,
        "rate_pct": 24
      },
      {
        "width_minor": 4166667,
        "rate_pct": 30
      },
      {
        "width_minor": null,
        "rate_pct": 36
      }
    ]
  },
  "tax": {
    "income_tax_pct": 15,
    "sscl_pct": 2.5,
    "sscl_thresholds": [
      {
        "effective_from": "2000-01-01",
        "quarterly_minor": 1500000000,
        "annual_minor": 6000000000
      },
      {
        "effective_from": "2026-07-01",
        "quarterly_minor": 900000000,
        "annual_minor": 3600000000
      }
    ],
    "vat_pct": 18,
    "vat_thresholds": [
      {
        "effective_from": "2000-01-01",
        "quarterly_minor": 1500000000,
        "annual_minor": 6000000000
      }
    ]
  },
  "allocation": {
    "method": "none",
    "fixed_pct": {}
  },
  "attention": {
    "receipt_required_above_minor": 500000,
    "reconcile_after_days": 31
  },
  "lists": {
    "channels": [
      "Upwork",
      "Direct Client",
      "Referral / Partner",
      "Other"
    ],
    "payment_methods": [
      "Bank Transfer",
      "Upwork Payout",
      "Payoneer",
      "Card",
      "Cash",
      "Other"
    ],
    "pricing_types": [
      "Fixed Price",
      "Hourly",
      "Milestone",
      "Retainer"
    ]
  }
}'::jsonb)
on conflict (id) do nothing;

insert into public.period_lock (id, locked_through) values (1, null)
on conflict (id) do nothing;
