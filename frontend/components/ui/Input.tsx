'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

/**
 * Sovereign Green field: 44px min height, 8px radius, 1px hairline stroke and a
 * 1.5px Royal Green focus ring with zero offset.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', ...props }, ref) => {
    return (
      <div className="w-full flex flex-col gap-1.5">
        {label && (
          <label className="font-label-lg text-label-lg text-on-surface">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full min-h-[48px] px-4 py-3 bg-white border border-brand-border rounded-input',
            'text-on-surface placeholder:text-on-surface-variant/50',
            'focus:outline-none focus:border-brand-green focus:ring-1 focus:ring-brand-green transition-all',
            error && 'border-brand-red focus:border-brand-red focus:ring-brand-red',
            className,
          )}
          {...props}
        />
        {error && <span className="text-xs text-brand-red font-medium">{error}</span>}
        {!error && helperText && (
          <span className="text-xs text-brand-textMuted">{helperText}</span>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
