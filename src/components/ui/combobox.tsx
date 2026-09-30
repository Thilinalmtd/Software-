import { Command } from 'cmdk';
import { Popover } from 'radix-ui';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
  group?: string;
  color?: string;
  keywords?: string[];
}

/** Searchable picker for accounts, categories, projects and contacts. */
export function Combobox({ value, onChange, options, placeholder = 'Select…', emptyText = 'No matches.', className, id, disabled, allowClear, onCreate, createLabel, 'aria-label': ariaLabel }: {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ComboOption[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  allowClear?: boolean;
  onCreate?: (text: string) => void;
  createLabel?: string;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = options.find((o) => o.value === value);
  const groups = useMemo(() => {
    const map = new Map<string, ComboOption[]>();
    for (const o of options) {
      const g = o.group ?? '';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(o);
    }
    return [...map.entries()];
  }, [options]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 text-left text-sm shadow-xs transition-colors hover:border-ink-2/40 focus:border-focus focus:ring-2 focus:ring-focus/25 focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-2',
            className,
          )}
        >
          <span className={cn('flex min-w-0 items-center gap-2 truncate', !selected && 'text-muted')}>
            {selected?.color && <span className="size-2 shrink-0 rounded-full" style={{ background: selected.color }} />}
            <span className="truncate">{selected ? selected.label : placeholder}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-64 rounded-lg border border-line bg-surface p-0 shadow-xl">
          <Command loop filter={(v, s, k) => ((v + ' ' + (k ?? []).join(' ')).toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
            <Command.Input autoFocus value={search} onValueChange={setSearch} placeholder="Type to search…" className="h-10 w-full border-b border-line bg-transparent px-3 text-sm text-ink outline-none placeholder:text-muted" />
            <Command.List className="max-h-72 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-4 text-center text-[13px] text-muted">{emptyText}</Command.Empty>
              {allowClear && value && (
                <Command.Item value="__clear" onSelect={() => { onChange(null); setOpen(false); }} className="flex h-8 cursor-pointer items-center rounded-md px-2 text-[13px] text-ink-2 data-[selected=true]:bg-surface-3">
                  Clear selection
                </Command.Item>
              )}
              {groups.map(([group, items]) => (
                <Command.Group key={group} heading={group || undefined} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase">
                  {items.map((o) => (
                    <Command.Item
                      key={o.value}
                      value={`${o.label} ${o.hint ?? ''} ${o.value}`}
                      keywords={o.keywords}
                      onSelect={() => {
                        onChange(o.value);
                        setOpen(false);
                        setSearch('');
                      }}
                      className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] text-ink data-[selected=true]:bg-surface-3"
                    >
                      {o.color && <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.hint && <span className="shrink-0 text-xs text-muted">{o.hint}</span>}
                      {o.value === value && <Check className="size-4 shrink-0 text-info" />}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              {onCreate && search.trim() && (
                <Command.Item value={`__create ${search}`} onSelect={() => { onCreate(search.trim()); setOpen(false); setSearch(''); }} className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-info data-[selected=true]:bg-surface-3">
                  <Plus className="size-4" /> {createLabel ?? 'Add'} “{search.trim()}”
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ComboField({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
    </div>
  );
}
