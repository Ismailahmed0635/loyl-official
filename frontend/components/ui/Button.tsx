'use client';

import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';
import { cn } from '@/lib/utils/cn';

interface ButtonProps extends HTMLMotionProps<'button'> {
  variant?: 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none min-h-[44px]';

  // Sovereign Green button recipes (DESIGN.md → Components → Buttons):
  // primary = Royal Green with a hairline inset; secondary/accent = Wine, the
  // destructive + redemption register every call site already uses it for;
  // outline = the design's "Secondary" (transparent + hairline stroke).
  // Hover/active stay token-only (brightness filter) so no hardcoded hex
  // drifts away from the Stitch palette.
  const variants = {
    primary:
      'bg-brand-green text-white hover:bg-brand-greenDark active:brightness-90 shadow-sm shadow-inset-light focus:ring-brand-green rounded-input',
    secondary:
      'bg-brand-red text-white hover:brightness-110 active:brightness-90 shadow-sm shadow-inset-light focus:ring-brand-red rounded-input',
    accent:
      'bg-brand-red text-white hover:brightness-110 active:brightness-90 shadow-sm shadow-inset-light focus:ring-brand-red rounded-input',
    outline:
      'border border-brand-border bg-white text-brand-textMain hover:bg-primary-container/[0.04] focus:ring-brand-green rounded-input',
    ghost:
      'text-brand-textMain hover:bg-primary-container/[0.04] focus:ring-outline rounded-input',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-base',
    lg: 'px-6 py-3.5 text-lg',
  };

  return (
    <motion.button
      whileTap={{ scale: disabled || isLoading ? 1 : 0.98 }}
      // tailwind-merge: an explicit className (e.g. a per-flow accent colour)
      // reliably wins over the variant defaults instead of racing the stylesheet.
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <svg
            className="animate-spin h-5 w-5 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          Loading...
        </span>
      ) : (
        children
      )}
    </motion.button>
  );
};
