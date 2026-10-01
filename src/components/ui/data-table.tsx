import { ArrowDown, ArrowUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sort?: (row: T) => string | number | null;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
  width?: string;
}

/** Sortable, paged table with sticky header and optional totals footer. */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, empty, footer, pageSize = 100, initialSort, className, rowClassName, dense }: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  footer?: ReactNode;
  pageSize?: number;
  initialSort?: { key: string; desc?: boolean };
  className?: string;
  rowClassName?: (row: T) => string | undefined;
  dense?: boolean;
}) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(initialSort ? { key: initialSort.key, desc: !!initialSort.desc } : null);
  const [limit, setLimit] = useState(pageSize);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * (sort.desc ? -1 : 1);
    });
  }, [rows, sort, columns]);
  const visible = sorted.slice(0, limit);
  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width }} className={cn('sticky top-0 z-[1] bg-surface px-3 py-2.5 text-xs font-medium whitespace-nowrap text-muted first:pl-5 last:pr-5', align(c.align), c.headerClassName)}>
                {c.sort ? (
                  <button
                    type="button"
                    className={cn('inline-flex cursor-pointer items-center gap-1 hover:text-ink', c.align === 'right' && 'flex-row-reverse')}
                    onClick={() => setSort((s) => (s?.key === c.key ? (s.desc ? null : { key: c.key, desc: true }) : { key: c.key, desc: false }))}
                  >
                    {c.header}
                    {sort?.key === c.key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                  </button>
                ) : (
                  c.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn('border-b border-line last:border-b-0', onRowClick && 'cursor-pointer hover:bg-surface-2', rowClassName?.(row))}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn('px-3 align-middle first:pl-5 last:pr-5', dense ? 'py-1.5' : 'py-2.5', align(c.align), c.align === 'right' && 'tabular', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="border-t-2 border-line-strong bg-surface-2 font-semibold">{footer}</tfoot>}
      </table>
      {sorted.length > limit && (
        <div className="flex items-center justify-center gap-3 border-t border-line py-3 text-[13px] text-ink-2">
          Showing {limit.toLocaleString()} of {sorted.length.toLocaleString()}
          <Button size="sm" onClick={() => setLimit((l) => l + pageSize * 2)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
