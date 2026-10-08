'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

interface IconTileProps {
  size?: 'sm' | 'md';
  className?: string;
  children: React.ReactNode;
}

/**
 * Stitch KPI icon tile: 44px rounded tile on a surface-container fill,
 * Royal Green glyph. Keeps the 44px minimum tap target.
 */
export const IconTile: React.FC<IconTileProps> = ({ size = 'md', className = '', children }) => {
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center rounded-lg bg-surface-container text-primary',
        size === 'md' ? 'h-11 w-11' : 'h-9 w-9',
        className,
      )}
      aria-hidden="true"
    >
      {children}
    </div>
  );
};
