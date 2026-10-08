'use client';

import React from 'react';

/**
 * Stitch page header: status pill row, headline, meta line and an
 * action cluster. Stacks on mobile, spreads on md+.
 * Pure layout — pages own data fetching and keep using lib/api wrappers.
 */
export const PageHeader: React.FC<{
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ eyebrow, title, meta, actions }) => {
  return (
    <div className="flex flex-col gap-space-md md:flex-row md:items-end md:justify-between">
      <div className="space-y-space-xs">
        {eyebrow && <div className="flex items-center gap-space-sm">{eyebrow}</div>}
        <h1 className="font-headline-lg text-headline-lg font-bold tracking-tight text-on-surface">
          {title}
        </h1>
        {meta && (
          <p className="flex flex-wrap items-center gap-2 font-body-md text-body-md text-on-surface-variant">
            {meta}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-space-sm self-start md:self-auto">{actions}</div>
      )}
    </div>
  );
};
