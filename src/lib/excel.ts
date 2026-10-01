import { saveFile } from './files';

// Formatted Excel exports (ExcelJS is loaded only when needed).

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
  /** 'money' = 2 decimals with red negatives in brackets (like the workbook), 'date', 'pct', 'text', 'rate' */
  type?: 'money' | 'date' | 'pct' | 'text' | 'rate' | 'int';
}

export interface SheetSpec {
  name: string;
  title?: string;
  subtitle?: string;
  columns: SheetColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

const MONEY = '#,##0.00;[Red](#,##0.00);-';

export async function exportWorkbook(fileName: string, sheets: SheetSpec[]): Promise<boolean> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AptoCAD Finance';
  wb.created = new Date();
  for (const spec of sheets) {
    const ws = wb.addWorksheet(spec.name.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'));
    let rowIndex = 1;
    if (spec.title) {
      ws.getCell(rowIndex, 1).value = spec.title;
      ws.getCell(rowIndex, 1).font = { bold: true, size: 14 };
      rowIndex++;
      if (spec.subtitle) {
        ws.getCell(rowIndex, 1).value = spec.subtitle;
        ws.getCell(rowIndex, 1).font = { color: { argb: 'FF52514E' } };
        rowIndex++;
      }
      rowIndex++;
    }
    const headerRow = ws.getRow(rowIndex);
    spec.columns.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF262626' } };
      cell.alignment = { vertical: 'middle', horizontal: c.type && c.type !== 'text' && c.type !== 'date' ? 'right' : 'left', wrapText: true };
      ws.getColumn(i + 1).width = c.width ?? (c.type === 'money' ? 16 : c.type === 'date' ? 12 : 22);
    });
    headerRow.height = 22;
    ws.views = [{ state: 'frozen', ySplit: rowIndex }];
    const write = (values: Record<string, unknown>, bold = false) => {
      rowIndex++;
      const row = ws.getRow(rowIndex);
      spec.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        let v = values[c.key];
        if (c.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          const [y, m, d] = v.split('-').map(Number);
          v = new Date(Date.UTC(y, m - 1, d));
          cell.numFmt = 'yyyy-mm-dd';
        }
        if (c.type === 'money') cell.numFmt = MONEY;
        if (c.type === 'pct') cell.numFmt = '0.0%';
        if (c.type === 'rate') cell.numFmt = '0.0000';
        if (c.type === 'int') cell.numFmt = '#,##0';
        cell.value = (v ?? null) as never;
        if (bold) cell.font = { bold: true };
      });
      if (bold) row.eachCell((cell) => (cell.border = { top: { style: 'thin' } }));
    };
    for (const r of spec.rows) write(r);
    if (spec.totals) write(spec.totals, true);
    ws.autoFilter = { from: { row: spec.title ? (spec.subtitle ? 4 : 3) : 1, column: 1 }, to: { row: spec.title ? (spec.subtitle ? 4 : 3) : 1, column: spec.columns.length } };
  }
  const buffer = await wb.xlsx.writeBuffer();
  return saveFile(fileName, new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), [{ name: 'Excel workbook', extensions: ['xlsx'] }]);
}

/** Minor units → number of whole currency units for Excel cells. */
export const xl = (minor: number | null | undefined) => (minor === null || minor === undefined ? null : minor / 100);
