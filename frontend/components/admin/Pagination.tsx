'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  /** e.g. "merchants" → "42 merchants". */
  noun: string;
  busy?: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/** Table footer pagination shared by the admin merchants/billing pages. */
export const Pagination: React.FC<PaginationProps> = ({
  page,
  totalPages,
  total,
  noun,
  busy = false,
  onPrev,
  onNext,
}) => {
  if (total === 0) return null;
  return (
    <div className="mt-space-md flex flex-wrap items-center justify-between gap-3">
      <p className="font-body-sm text-body-sm text-on-surface-variant tabular-nums">
        {total} {noun}
      </p>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={page <= 1 || busy} onClick={onPrev}>
          Previous
        </Button>
        <span className="font-body-sm text-body-sm text-on-surface-variant tabular-nums">
          Page {page} of {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages || busy} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
};
