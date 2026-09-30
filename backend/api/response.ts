import { NextResponse } from 'next/server';

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
  /** Optional context (e.g. nextScanAt, nearest branch) merged by apiError. */
  data?: unknown;
}

export function apiSuccess<T>(data: T, status: number = 200): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(
  message: string,
  code: string = 'BAD_REQUEST',
  status: number = 400,
  extra?: Record<string, unknown>
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    {
      success: false,
      error: { code, message },
      ...(extra !== undefined ? { data: extra } : {}),
    },
    { status }
  );
}
