import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { ReactElement } from 'react';
import { formatMoney } from '@/domain/money';
import { formatDate } from '@/domain/period';
import type { CompanySettings, Invoice, InvoiceItem, Party, Payslip } from '@/domain/types';
import { saveFile } from './files';

// Printable documents (payslips, invoices, simple reports). Uses the built-in Helvetica font.

const BRAND = '#E00200';
const INK = '#111213';
const MUTED = '#6B6A66';

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: INK },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24, alignItems: 'flex-start' },
  brandBar: { height: 4, backgroundColor: BRAND, marginBottom: 20, width: 60 },
  company: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  muted: { color: MUTED },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  section: { marginBottom: 16 },
  label: { fontSize: 8, color: MUTED, textTransform: 'uppercase', marginBottom: 3, letterSpacing: 0.5 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#DDDDDD', paddingVertical: 6 },
  headRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: INK, paddingVertical: 6 },
  bold: { fontFamily: 'Helvetica-Bold' },
  right: { textAlign: 'right' },
  totalBox: { marginTop: 12, marginLeft: 'auto', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: INK, marginTop: 4 },
  footer: { position: 'absolute', bottom: 30, left: 40, right: 40, fontSize: 8, color: MUTED, textAlign: 'center' },
});

async function download(doc: ReactElement, fileName: string) {
  const blob = await pdf(doc as never).toBlob();
  return saveFile(fileName, blob, [{ name: 'PDF', extensions: ['pdf'] }]);
}

function Letterhead({ settings, title, subtitle }: { settings: CompanySettings; title: string; subtitle?: string }) {
  return (
    <View style={s.header}>
      <View>
        <View style={s.brandBar} />
        <Text style={s.company}>{settings.company_name}</Text>
        {settings.address ? <Text style={s.muted}>{settings.address}</Text> : null}
        {settings.tax_id ? <Text style={s.muted}>TIN {settings.tax_id}</Text> : null}
      </View>
      <View>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={[s.muted, s.right]}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- payslip

export async function downloadPayslip(p: { settings: CompanySettings; payslip: Payslip; employee: Party; periodLabel: string; payDate: string; departmentName: string }) {
  const { payslip: ps, employee } = p;
  const m = (v: number) => formatMoney(v, 'LKR', { plain: true });
  const line = (label: string, value: number, bold = false) => (
    <View style={s.row} key={label}>
      <Text style={[{ flex: 1 }, bold ? s.bold : {}]}>{label}</Text>
      <Text style={[{ width: 120 }, s.right, bold ? s.bold : {}]}>{m(value)}</Text>
    </View>
  );
  const doc = (
    <Document title={`Payslip ${employee.name} ${p.periodLabel}`}>
      <Page size="A4" style={s.page}>
        <Letterhead settings={p.settings} title="Payslip" subtitle={`${p.periodLabel} · paid ${formatDate(p.payDate)}`} />
        <View style={[s.section, { flexDirection: 'row', gap: 40 }]}>
          <View>
            <Text style={s.label}>Employee</Text>
            <Text style={s.bold}>{employee.name}</Text>
            {employee.designation ? <Text>{employee.designation}</Text> : null}
            {employee.epf_number ? <Text style={s.muted}>EPF No. {employee.epf_number}</Text> : null}
          </View>
          <View>
            <Text style={s.label}>Department</Text>
            <Text>{p.departmentName}</Text>
          </View>
        </View>
        <View style={s.section}>
          <Text style={s.label}>Earnings (LKR)</Text>
          {line('Basic salary', ps.basic_minor)}
          {ps.epf_allowances_minor ? line('Allowances (EPF liable)', ps.epf_allowances_minor) : null}
          {ps.other_allowances_minor ? line('Other allowances', ps.other_allowances_minor) : null}
          {line('Gross pay', ps.gross_minor, true)}
        </View>
        <View style={s.section}>
          <Text style={s.label}>Deductions (LKR)</Text>
          {ps.employee_epf_minor ? line('EPF — employee 8%', ps.employee_epf_minor) : null}
          {ps.apit_minor ? line('APIT (PAYE tax)', ps.apit_minor) : null}
          {ps.other_deductions_minor ? line('Other deductions', ps.other_deductions_minor) : null}
          {line('Total deductions', ps.employee_epf_minor + ps.apit_minor + ps.other_deductions_minor, true)}
        </View>
        <View style={[s.grand, { width: 300, marginLeft: 'auto' }]}>
          <Text style={[s.bold, { fontSize: 12 }]}>Net pay</Text>
          <Text style={[s.bold, { fontSize: 12 }]}>LKR {m(ps.net_minor)}</Text>
        </View>
        {ps.epf_applicable ? (
          <View style={[s.section, { marginTop: 24 }]}>
            <Text style={s.label}>Employer contributions (not deducted from pay)</Text>
            {line('EPF — employer 12%', ps.employer_epf_minor)}
            {line('ETF — employer 3%', ps.etf_minor)}
          </View>
        ) : null}
        <Text style={s.footer}>This payslip was generated by AptoCAD Finance. Please keep it for your records.</Text>
      </Page>
    </Document>
  );
  return download(doc, `payslip-${employee.name.replace(/\s+/g, '-')}-${p.periodLabel.replace(/\s+/g, '-')}.pdf`);
}

// ---------------------------------------------------------------- invoice / quote

export async function downloadInvoice(p: { settings: CompanySettings; invoice: Invoice; items: InvoiceItem[]; client: Party | undefined; projectName?: string; paidMinor: number }) {
  const { invoice: inv } = p;
  const m = (v: number) => formatMoney(v, inv.currency, { plain: true });
  const isQuote = inv.kind === 'quote';
  const outstanding = inv.total_minor - p.paidMinor;
  const doc = (
    <Document title={`${isQuote ? 'Quote' : 'Invoice'} ${inv.number}`}>
      <Page size="A4" style={s.page}>
        <Letterhead settings={p.settings} title={isQuote ? 'Quotation' : 'Invoice'} subtitle={inv.number} />
        <View style={[s.section, { flexDirection: 'row', justifyContent: 'space-between' }]}>
          <View style={{ maxWidth: 260 }}>
            <Text style={s.label}>{isQuote ? 'Prepared for' : 'Bill to'}</Text>
            <Text style={s.bold}>{p.client?.name ?? ''}</Text>
            {p.client?.address ? <Text>{p.client.address}</Text> : null}
            {p.client?.country ? <Text>{p.client.country}</Text> : null}
            {p.client?.email ? <Text style={s.muted}>{p.client.email}</Text> : null}
          </View>
          <View style={{ width: 200 }}>
            <View style={s.totalRow}><Text style={s.muted}>{isQuote ? 'Date' : 'Invoice date'}</Text><Text>{formatDate(inv.issue_date)}</Text></View>
            {inv.due_date ? <View style={s.totalRow}><Text style={s.muted}>{isQuote ? 'Valid until' : 'Due date'}</Text><Text>{formatDate(inv.due_date)}</Text></View> : null}
            {p.projectName ? <View style={s.totalRow}><Text style={s.muted}>Project</Text><Text style={{ maxWidth: 120, textAlign: 'right' }}>{p.projectName}</Text></View> : null}
            <View style={s.totalRow}><Text style={s.muted}>Currency</Text><Text>{inv.currency}</Text></View>
          </View>
        </View>
        <View style={s.headRow}>
          <Text style={[{ flex: 1 }, s.bold]}>Description</Text>
          <Text style={[{ width: 50 }, s.right, s.bold]}>Qty</Text>
          <Text style={[{ width: 90 }, s.right, s.bold]}>Rate</Text>
          <Text style={[{ width: 100 }, s.right, s.bold]}>Amount</Text>
        </View>
        {p.items.map((it) => (
          <View style={s.row} key={it.id}>
            <Text style={{ flex: 1 }}>{it.description}</Text>
            <Text style={[{ width: 50 }, s.right]}>{Number(it.quantity).toString()}</Text>
            <Text style={[{ width: 90 }, s.right]}>{m(it.unit_price_minor)}</Text>
            <Text style={[{ width: 100 }, s.right]}>{m(it.amount_minor)}</Text>
          </View>
        ))}
        <View style={s.totalBox}>
          <View style={s.totalRow}><Text>Subtotal</Text><Text>{m(inv.subtotal_minor)}</Text></View>
          {inv.discount_minor ? <View style={s.totalRow}><Text>Discount</Text><Text>-{m(inv.discount_minor)}</Text></View> : null}
          {inv.tax_minor ? <View style={s.totalRow}><Text>Tax</Text><Text>{m(inv.tax_minor)}</Text></View> : null}
          <View style={s.grand}><Text style={s.bold}>Total {inv.currency}</Text><Text style={s.bold}>{m(inv.total_minor)}</Text></View>
          {!isQuote && p.paidMinor > 0 ? (
            <>
              <View style={s.totalRow}><Text>Paid</Text><Text>-{m(p.paidMinor)}</Text></View>
              <View style={s.totalRow}><Text style={s.bold}>Balance due</Text><Text style={s.bold}>{m(outstanding)}</Text></View>
            </>
          ) : null}
        </View>
        {inv.notes ? <View style={[s.section, { marginTop: 24 }]}><Text style={s.label}>Notes</Text><Text>{inv.notes}</Text></View> : null}
        {inv.terms ? <View style={s.section}><Text style={s.label}>Terms</Text><Text>{inv.terms}</Text></View> : null}
        {p.settings.invoice_footer ? <Text style={s.footer}>{p.settings.invoice_footer}</Text> : null}
      </Page>
    </Document>
  );
  return download(doc, `${inv.number}.pdf`);
}

// ---------------------------------------------------------------- generic table report

export interface PdfTable {
  title: string;
  subtitle?: string;
  columns: { header: string; width?: number; align?: 'left' | 'right' }[];
  rows: string[][];
  totals?: string[];
  landscape?: boolean;
}

export async function downloadTableReport(settings: CompanySettings, fileName: string, t: PdfTable) {
  const doc = (
    <Document title={t.title}>
      <Page size="A4" orientation={t.landscape ? 'landscape' : 'portrait'} style={[s.page, { fontSize: 8.5 }]}>
        <Letterhead settings={settings} title={t.title} subtitle={t.subtitle} />
        <View style={s.headRow} fixed>
          {t.columns.map((c, i) => (
            <Text key={i} style={[c.width ? { width: c.width } : { flex: 1 }, c.align === 'right' ? s.right : {}, s.bold]}>{c.header}</Text>
          ))}
        </View>
        {t.rows.map((r, ri) => (
          <View style={s.row} key={ri} wrap={false}>
            {r.map((cell, i) => (
              <Text key={i} style={[t.columns[i].width ? { width: t.columns[i].width } : { flex: 1 }, t.columns[i].align === 'right' ? s.right : {}]}>{cell}</Text>
            ))}
          </View>
        ))}
        {t.totals ? (
          <View style={[s.headRow, { borderTopWidth: 1, borderBottomWidth: 0 }]}>
            {t.totals.map((cell, i) => (
              <Text key={i} style={[t.columns[i].width ? { width: t.columns[i].width } : { flex: 1 }, t.columns[i].align === 'right' ? s.right : {}, s.bold]}>{cell}</Text>
            ))}
          </View>
        ) : null}
        <Text style={s.footer} render={({ pageNumber, totalPages }) => `${settings.company_name} · generated ${new Date().toLocaleString()} · page ${pageNumber} of ${totalPages}`} fixed />
      </Page>
    </Document>
  );
  return download(doc, fileName);
}
