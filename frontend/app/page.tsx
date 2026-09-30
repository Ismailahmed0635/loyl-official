import { redirect } from 'next/navigation';

/**
 * Phase 7: the main app sits strictly behind auth — the root path bounces
 * straight to the sign-in flow. The SEO-friendly landing directory (Phase 6)
 * replaces this when it lands.
 */
export default function RootPage() {
  redirect('/welcome');
}
