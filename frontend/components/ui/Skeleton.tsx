import React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Loading shimmer block (Phase 8 loading states).
 *
 * Plain server-safe div — the pulse is Tailwind's `animate-pulse`, the same
 * primitive the live dots in welcome/Dice/Scratch already use, so loading
 * feedback stays dependency-free and works before hydration.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-input bg-surface-container-high', className)}
    />
  );
}
