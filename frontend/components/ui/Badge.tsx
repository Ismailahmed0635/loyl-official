'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

type BadgeTone = 'success' | 'neutral' | 'wine' | 'outline';

const TONES: Record<BadgeTone, string> = {
  // Stitch pill badges: pale tint fill + matching text, 11px uppercase.
  success: 'bg-primary-fixed text-on-primary-fixed',
  neutral: 'bg-surface-container-high text-on-surface-variant',
  wine: 'bg-secondary-fixed text-on-secondary-fixed',
  outline: 'border border-hairline bg-surface-container-lowest text-on-surface-variant',
};

interface BadgeProps {
  tone?: BadgeTone;
  uppercase?: boolean;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Stitch pill badge used for status, counts and micro-metadata. */
export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  uppercase = false,
  dot = false,
  className = '',
  children,
}) => {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-0.5 font-label-sm text-label-sm font-semibold',
        uppercase && 'uppercase tracking-wide',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
};
