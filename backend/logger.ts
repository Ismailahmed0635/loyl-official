/**
 * backend/logger.ts — structured server logging (P-03/P-04, no new deps).
 *
 * One JSON line per call: { ts, level, msg, requestId?, ...fields }.
 * PII scrubbing: phone-like digit runs and emails are redacted before
 * anything is written, so request logs can never carry customer numbers.
 * Errors log name + message + digest, never tokens or bodies.
 *
 * Sink: stdout (Vercel/Cloud Run capture it; `gcloud logging` / Datadog pick
 * it up as JSON). Swap `emit` for a forwarder when a vendor is chosen.
 */

export type LogLevel = 'info' | 'warn' | 'error';

const PHONE_RUN = /(\+?88)?01[3-9]\d{8}/g;
const EMAIL_RUN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function scrub(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(PHONE_RUN, '[PHONE]').replace(EMAIL_RUN, '[EMAIL]');
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrub(value.message),
      ...(typeof (value as { digest?: unknown }).digest === 'string'
        ? { digest: (value as { digest?: string }).digest }
        : {}),
    };
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (scrub(fields) as Record<string, unknown>) : {}),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
