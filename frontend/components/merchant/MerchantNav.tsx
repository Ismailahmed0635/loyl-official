'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { logout } from '@/lib/api/client';
import { listScanRequests } from '@/lib/api/merchant';
import { useQuery } from '@/lib/api/cache';
import { scaleIn, EASE_OUT } from '@/lib/motion/variants';
import {
  LayoutDashboard,
  Store,
  Plus,
  X,
  LogOut,
  Stamp,
  Tag,
  MapPin,
  BarChart3,
  Users,
  Settings,
  CreditCard,
  BellRing,
  BookOpen,
  MoreHorizontal,
} from 'lucide-react';

interface MerchantNavProps {
  businessName?: string;
  logoUrl?: string | null;
}

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/requests', label: 'Requests', icon: BellRing },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/branches', label: 'Branches', icon: Store },
  { href: '/billing', label: 'Billing', icon: CreditCard },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/**
 * Sovereign Green mobile bar: five frosted tabs (the design's
 * Dashboard / Offers / Customers / Branches / More anatomy, mapped
 * onto the routes this app actually has). "More" opens the quick menu that the
 * pre-redesign draggable FAB used to open, so nothing becomes unreachable.
 */
const MOBILE_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/requests', label: 'Requests', icon: BellRing },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/branches', label: 'Branches', icon: Store },
] as const;

export const MerchantNav: React.FC<MerchantNavProps> = ({ businessName }) => {
  const pathname = usePathname();
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Phase 9: open stamp-request count for the Requests badge (best-effort).
  // Reads through lib/api/cache, so re-mounting the shell (returning to the
  // dashboard) paints the last known count instead of waiting on the network,
  // and the 15s tick revalidates it rather than replacing it with a spinner.
  const { data: pendingData, refetch: refetchPending } = useQuery<number>(
    'scan-requests:pending:count',
    async () => {
      const res = await listScanRequests({ status: 'PENDING', pageSize: 1 });
      return res?.success ? (res.data?.pendingCount ?? 0) : 0;
    },
    { ttl: 15_000 }
  );
  const pendingCount = pendingData ?? 0;

  // The badge is a poll by nature — kick it on an interval, but every tick goes
  // through the cache, so a page already holding this key reuses the response.
  // Skipped while the tab is hidden so background tabs pay no network.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.hidden) return;
      refetchPending();
    }, 15_000);
    return () => window.clearInterval(t);
  }, [refetchPending]);

  // Close the quick menu on Escape (matches the dialog behaviour elsewhere).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      router.push('/welcome');
    }
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const menuItemClass =
    'w-full flex items-center gap-3 px-4 min-h-[48px] text-sm font-medium text-on-surface hover:bg-surface-container-low transition-colors';

  return (
    <>
      {/* Frosted top bar: brand + desktop top-nav (lg+) */}
      <header className="sticky top-0 z-40 bg-white/85 frost shadow-frost">
        <div className="max-w-md mx-auto md:max-w-2xl lg:max-w-6xl px-4 h-16 flex items-center gap-3">
          <Link href="/dashboard" prefetch={true} className="flex items-center gap-2.5 shrink-0" aria-label="Loyl home">
            <span className="w-9 h-9 rounded-lg bg-brand-green text-white grid place-items-center shadow-inset-light">
              <Stamp size={18} />
            </span>
            <span className="hidden sm:flex flex-col leading-none">
              <span className="font-headline-sm text-headline-sm text-brand-green font-bold tracking-tight">
                Loyl
              </span>
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider mt-1">
                Merchant
              </span>
            </span>
          </Link>

          {businessName && (
            <span className="hidden xl:flex items-center gap-2 max-w-[240px] bg-surface-container-low rounded-xl px-3 py-1.5">
              <Store size={16} className="text-on-surface-variant shrink-0" />
              <span className="truncate font-label-lg text-label-lg text-on-surface">
                {businessName}
              </span>
            </span>
          )}

{/* Desktop top-nav — labels only. Icons are deliberately omitted here: with
            them the 7 links need ~741px while the header can afford ~623px at
            lg..xl, so the last item used to spill over the "New Offer" button
            (CODIN §10, defect 1). Labels alone need ~587px and fit at every
            desktop width; the icons still live in the mobile bar and quick menu. */}
          <nav className="hidden lg:flex items-center gap-1 ml-2 min-w-0" aria-label="Merchant">
            {NAV_ITEMS.map((item) => {
              const showBadge = item.href === '/requests' && pendingCount > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  className={`relative inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-label-lg whitespace-nowrap transition-colors min-h-[44px] ${
                    isActive(item.href)
                      ? 'bg-brand-green text-white font-semibold shadow-inset-light'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  {item.label}
                  {showBadge && (
                    <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-pill bg-brand-red text-white text-[10px] font-bold">
                      {pendingCount > 99 ? '99+' : pendingCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              className="hidden md:inline-flex rounded-lg"
              onClick={() => router.push('/offers/new')}
            >
              <Plus className="w-4 h-4 mr-1.5" /> New Offer
            </Button>
            <button
              onClick={handleLogout}
              className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-brand-green"
              aria-label="Log out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Frosted mobile bottom-nav */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 frost shadow-[0_-2px_12px_rgba(0,0,0,0.03)] pb-[env(safe-area-inset-bottom)]"
        aria-label="Merchant"
      >
        <div className="h-16 px-1 flex items-center justify-around">
          {MOBILE_NAV.map((item) => {
            const Icon = item.icon;
            const showBadge = item.href === '/requests' && pendingCount > 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                className={`relative flex flex-col items-center justify-center min-w-[56px] h-12 gap-0.5 transition-colors ${
                  isActive(item.href)
                    ? 'text-brand-green font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                aria-current={isActive(item.href) ? 'page' : undefined}
              >
                <Icon className="w-[22px] h-[22px]" />
                <span className="font-label-sm text-label-sm">{item.label}</span>
                {showBadge && (
                  <span className="absolute top-0 right-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-pill bg-brand-red text-white text-[9px] font-bold">
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
              </Link>
            );
          })}

          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className={`flex flex-col items-center justify-center min-w-[56px] h-12 gap-0.5 transition-colors ${
              menuOpen
                ? 'text-brand-green font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <MoreHorizontal className="w-[22px] h-[22px]" />
            <span className="font-label-sm text-label-sm">More</span>
          </button>
        </div>
      </nav>

      {/* Quick-menu backdrop (closes the menu on outside tap) */}
      {menuOpen && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 z-40 bg-inverse-surface/30 cursor-default"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Quick menu — anchored above the "More" tab */}
      <div className="lg:hidden fixed right-3 bottom-[76px] z-50" ref={menuRef}>
        {menuOpen && (
          <motion.div
            initial={shouldReduceMotion ? false : 'hidden'}
            animate="visible"
            variants={scaleIn}
            transition={{ ease: EASE_OUT }}
            className="w-56 bg-surface-container-lowest rounded-card shadow-ambient border border-hairline overflow-hidden"
            role="menu"
          >
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setMenuOpen(false);
                router.push('/requests');
              }}
            >
              <BellRing size={18} className="text-brand-red" /> Stamp Requests
              {pendingCount > 0 && (
                <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-pill bg-brand-red text-white text-[10px] font-bold">
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </button>
            <div className="border-t border-hairline" />
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setMenuOpen(false);
                router.push('/offers/new');
              }}
            >
              <Tag size={18} className="text-brand-amber" /> New Offer
            </button>
            <div className="border-t border-hairline" />
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setMenuOpen(false);
                router.push('/menu');
              }}
            >
              <BookOpen size={18} className="text-brand-green" /> Digital Menu
            </button>
            <div className="border-t border-hairline" />
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setMenuOpen(false);
                router.push('/analytics');
              }}
            >
              <BarChart3 size={18} className="text-brand-green" /> Analytics
            </button>
            <div className="border-t border-hairline" />
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setMenuOpen(false);
                router.push('/billing');
              }}
            >
              <CreditCard size={18} className="text-brand-green" /> Billing
            </button>
            <div className="border-t border-hairline" />
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setMenuOpen(false);
                router.push('/settings');
              }}
            >
              <Settings size={18} className="text-on-surface-variant" /> Settings
            </button>
            <div className="border-t border-hairline" />
            <button
              type="button"
              role="menuitem"
              className={menuItemClass}
              onClick={() => {
                setMenuOpen(false);
                router.push('/branches?new=1');
              }}
            >
              <MapPin size={18} className="text-brand-green" /> Add Branch
            </button>
          </motion.div>
        )}
      </div>
    </>
  );
};
