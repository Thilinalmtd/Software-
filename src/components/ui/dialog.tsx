import { Dialog as RDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { Textarea } from './form';

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md', className }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
}) {
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[1320px]' }[size];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <RDialog.Content
          className={cn('animate-pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-line bg-surface shadow-2xl', width, className)}
          onOpenAutoFocus={(e) => {
            const target = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[autofocus],[data-autofocus]');
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <RDialog.Title className="text-[17px] font-semibold text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-0.5 text-[13px] text-ink-2">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-6 py-3 rounded-b-xl">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Right-hand panel for record details. */
export function Sheet({ open, onOpenChange, title, description, children, footer, width = 'max-w-2xl' }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="animate-fade-in fixed inset-0 z-40 bg-black/30" />
        <RDialog.Content className={cn('animate-slide-in fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-2xl', width)}>
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div className="min-w-0">
              <RDialog.Title className="truncate text-[17px] font-semibold text-ink">{title}</RDialog.Title>
              {description ? <RDialog.Description asChild><div className="mt-0.5 text-[13px] text-ink-2">{description}</div></RDialog.Description> : <RDialog.Description className="sr-only">Details</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-6 py-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel = 'Confirm', danger, onConfirm, requireReason, reasonLabel = 'Reason' }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason('');
        onOpenChange(o);
      }}
      title={title}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={requireReason && !reason.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                setReason('');
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body && <div className="text-sm text-ink-2">{body}</div>}
      {requireReason && (
        <div className="mt-4">
          <label className="mb-1.5 block text-[13px] font-medium text-ink-2" htmlFor="confirm-reason">
            {reasonLabel}
          </label>
          <Textarea id="confirm-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" />
        </div>
      )}
    </Dialog>
  );
}
