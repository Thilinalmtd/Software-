import { Checkbox as RCheckbox, Switch as RSwitch } from 'radix-ui';
import { Check } from 'lucide-react';
import { cloneElement, forwardRef, isValidElement, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { currencyDecimals, minorToInput, toMinor } from '@/domain/money';
import { cn } from '@/lib/cn';

const fieldBase =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted shadow-xs transition-colors focus:border-focus focus:outline-none focus:ring-2 focus:ring-focus/25 disabled:bg-surface-2 disabled:text-muted aria-[invalid=true]:border-negative';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, 'h-9', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[]; placeholder?: string }>(
  ({ className, options, placeholder, ...props }, ref) => (
    <select ref={ref} className={cn(fieldBase, 'h-9 cursor-pointer pr-8', className)} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  ),
);
Select.displayName = 'Select';

export function Label({ children, htmlFor, className }: { children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-[13px] font-medium text-ink-2', className)}>
      {children}
    </label>
  );
}

/** Label + control. The label is linked to the control automatically (for screen readers and click-to-focus). */
export function Field({ label, hint, error, children, className, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  const autoId = useId();
  let id = htmlFor;
  let control = children;
  if (!id && isValidElement<{ id?: string }>(children)) {
    id = children.props.id ?? autoId;
    if (!children.props.id) control = cloneElement(children, { id });
  }
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {control}
      {error ? <p className="mt-1 text-xs text-negative">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/**
 * Amount input bound to integer minor units. Accepts "1,250.50", shows grouped digits when
 * not focused, and reports null while the text is not a number.
 */
export function MoneyInput({ value, onChange, currency = 'LKR', className, id, placeholder = '0.00', autoFocus, disabled, allowNegative = false, 'aria-label': ariaLabel }: {
  value: number | null;
  onChange: (minor: number | null) => void;
  currency?: string;
  className?: string;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  allowNegative?: boolean;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(() => minorToInput(value, currency));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === null ? '' : formatGrouped(value, currency));
  }, [value, currency, focused]);
  return (
    <div className={cn('relative', className)}>
      <input
        id={id}
        inputMode="decimal"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={ariaLabel}
        className={cn(fieldBase, 'h-9 pr-12 text-right tabular')}
        placeholder={placeholder}
        value={text}
        onFocus={(e) => {
          // Switch to the plain editable number and select it in the same tick, so typing replaces it.
          const raw = value === null ? '' : minorToInput(value, currency);
          e.target.value = raw;
          e.target.select();
          setText(raw);
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          const v = toMinor(text, currency);
          setText(v === null ? '' : formatGrouped(v, currency));
        }}
        onChange={(e) => {
          const t = e.target.value;
          if (!/^[-\d.,\s]*$/.test(t)) return;
          setText(t);
          const v = toMinor(t, currency);
          onChange(v !== null && !allowNegative && v < 0 ? null : v);
        }}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted">{currency}</span>
    </div>
  );
}

function formatGrouped(minor: number, currency: string): string {
  const d = currencyDecimals(currency);
  return (minor / 10 ** d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function Checkbox({ checked, onCheckedChange, id, disabled, 'aria-label': ariaLabel }: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; disabled?: boolean; 'aria-label'?: string }) {
  return (
    <RCheckbox.Root
      id={id}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      className="flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-line-strong bg-surface data-[state=checked]:border-info data-[state=checked]:bg-info disabled:opacity-50"
    >
      <RCheckbox.Indicator>
        <Check className="size-3.5 text-white" strokeWidth={3} />
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
}

export function Switch({ checked, onCheckedChange, id, disabled, 'aria-label': ariaLabel }: { checked: boolean; onCheckedChange: (v: boolean) => void; id?: string; disabled?: boolean; 'aria-label'?: string }) {
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onCheckedChange={onCheckedChange}
      className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-line-strong transition-colors data-[state=checked]:bg-positive disabled:opacity-50"
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
}

export function SegmentedControl<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-lg bg-surface-3 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('h-8 cursor-pointer rounded-md px-3 text-[13px] font-medium text-ink-2 transition-colors', value === o.value ? 'bg-surface text-ink shadow-sm' : 'hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
