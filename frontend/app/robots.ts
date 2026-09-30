import { buildRobots } from '@/lib/metadata';

/** Phase 8 — serves `/robots.txt`: everything disallowed except public menus. */
export default function robots(): ReturnType<typeof buildRobots> {
  return buildRobots();
}
