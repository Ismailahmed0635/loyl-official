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
    'inline-flex items-center justify-center gap-1.5 text-center font-semibold transition-[transform,background-color,border-color,box-shadow,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none [&_svg]:shrink-0';

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
    // sm is visually compact (36px) for dense/inline actions; the ::before
    // pad expands its hit area back to 44px (better-ui hit-area rule).
    sm: 'relative min-h-[36px] px-3 py-1 text-[13px] leading-5 before:absolute before:-inset-2 before:content-[""] [&_svg]:size-3.5',
    // md keeps the 44px tap-target rule but drops a padding step + a type
    // step (was py-2.5 text-base) so default buttons stop dominating.
    md: 'min-h-[44px] px-4 py-2 text-sm leading-5 [&_svg]:size-4',
    lg: 'min-h-[48px] px-5 py-2.5 text-[15px] leading-6 [&_svg]:size-[18px]',
  };

  return (
    <motion.button
      whileTap={{ scale: disabled || isLoading ? 1 : 0.96 }}
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
