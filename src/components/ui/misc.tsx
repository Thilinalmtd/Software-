import { DropdownMenu as RMenu, Tabs as RTabs, Tooltip as RTooltip } from 'radix-ui';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ children, className, title, action, description, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; description?: ReactNode; padded?: boolean }) {
  return (
    <section className={cn('rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.04)]', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-ink-2">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn(padded && 'px-5 pb-5', padded && !title && !action && 'pt-5')}>{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'positive' | 'negative' | 'caution' | 'info' | 'brand';
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  caution: 'bg-caution-soft text-caution',
  info: 'bg-info-soft text-info',
  brand: 'bg-brand-soft text-brand',
};

export function Badge({ children, tone = 'neutral', className, dot }: { children: ReactNode; tone?: Tone; className?: string; dot?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} />}
      {children}
    </span>
  );
}

export function Spinner({ className, label = 'Loading…' }: { className?: string; label?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-sm text-muted', className)} role="status">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-surface-3 text-ink-2 [&_svg]:size-5">{icon}</div>}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-md text-[13px] text-ink-2">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1 text-[13px] text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

/** Stat tile: label · value · optional delta/foot. */
export function StatTile({ label, value, foot, tone, onClick, icon }: { label: string; value: ReactNode; foot?: ReactNode; tone?: 'positive' | 'negative' | 'neutral'; onClick?: () => void; icon?: ReactNode }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('group flex min-w-0 flex-col rounded-xl border border-line bg-surface px-5 py-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)]', onClick && 'cursor-pointer transition-colors hover:border-line-strong hover:bg-surface-2')}
    >
      <span className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
        {icon && <span className="text-muted [&_svg]:size-4">{icon}</span>}
        {label}
      </span>
      <span className={cn('mt-2 truncate text-[26px] leading-8 font-semibold tracking-tight', tone === 'negative' ? 'text-negative' : 'text-ink')}>{value}</span>
      {foot && <span className="mt-1 truncate text-xs text-ink-2">{foot}</span>}
    </Comp>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, children, className, listClassName }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; children?: ReactNode; className?: string; listClassName?: string }) {
  return (
    <RTabs.Root value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      <RTabs.List className={cn('flex gap-1 overflow-x-auto border-b border-line', listClassName)}>
        {tabs.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px inline-flex h-10 cursor-pointer items-center gap-2 border-b-2 border-transparent px-3 text-[13px] font-medium whitespace-nowrap text-ink-2 hover:text-ink data-[state=active]:border-brand data-[state=active]:text-ink"
          >
            {t.label}
            {t.count !== undefined && <span className="rounded-full bg-surface-3 px-1.5 text-[11px] text-ink-2 tabular">{t.count}</span>}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Provider delayDuration={250}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-xs text-surface shadow-lg">
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: (MenuItem | 'separator')[]; align?: 'start' | 'end' }) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-lg border border-line bg-surface p-1 shadow-xl">
          {items.map((item, i) =>
            item === 'separator' ? (
              <RMenu.Separator key={i} className="my-1 h-px bg-line" />
            ) : (
              <RMenu.Item
                key={i}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn('flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-3 [&_svg]:size-4', item.danger ? 'text-negative' : 'text-ink')}
              >
                {item.icon}
                {item.label}
              </RMenu.Item>
            ),
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export function Callout({ tone = 'info', title, children, icon, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-lg px-4 py-3 text-[13px]', TONES[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] text-ink-2">{children}</kbd>;
}
