import { buildManifest } from '@/lib/metadata';

/** Phase 8 — serves `/manifest.webmanifest` (web-only polish, not installable). */
export default function manifest(): ReturnType<typeof buildManifest> {
  return buildManifest();
}
