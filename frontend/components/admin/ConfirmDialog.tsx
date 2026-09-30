'use client';

import React, { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { scaleIn } from '@/lib/motion/variants';
import { Button } from '@/components/ui/Button';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** Red confirm button for destructive actions (suspend, reject). */
  danger?: boolean;
  isBusy?: boolean;
  /** Optional extra controls (e.g. the Phase 7 tier dropdown on approve). */
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Admin confirmation modal — required for destructive/irreversible actions
 * (suspend merchant, approve/reject payment). Escape and backdrop close it.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  isBusy = false,
  children,
  onConfirm,
  onCancel,
}) => {
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isBusy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-inverse-surface/40 p-4"
      onClick={() => {
        if (!isBusy) onCancel();
      }}
    >
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        initial={shouldReduceMotion ? false : 'hidden'}
        animate="visible"
        variants={scaleIn}
        className="w-full max-w-sm rounded-xl bg-surface-container-lowest p-6 shadow-ambient border border-hairline"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span
            className={`inline-flex shrink-0 items-center justify-center w-9 h-9 rounded-input ${
              danger ? 'bg-error-container text-on-error-container' : 'bg-primary-fixed text-on-primary-fixed'
            }`}
          >
            <AlertTriangle size={18} />
          </span>
          <div>
            <h2
              id="confirm-dialog-title"
              className="font-headline-sm text-headline-sm text-on-surface"
            >
              {title}
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant mt-1.5">
              {description}
            </p>
          </div>
        </div>
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isBusy}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'accent' : 'primary'}
            size="sm"
            onClick={onConfirm}
            isLoading={isBusy}
          >
            {confirmLabel}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
