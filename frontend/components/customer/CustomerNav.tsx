'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { logout } from '@/lib/api/client';
import { Stamp, Gift, User, LogOut } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/stamp-card', label: 'Stamp Cards', icon: Stamp },
  { href: '/reward', label: 'Rewards', icon: Gift },
  { href: '/profile', label: 'Profile', icon: User },
] as const;

/**
 * Customer shell navigation (Phase 3): desktop top-nav, mobile bottom-nav —
 * same layout contract as MerchantNav (mobile-first, 44px targets).
 */
export const CustomerNav: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      router.replace('/scan');
    }
  };

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      {/* Frosted top bar: brand + desktop top-nav (md+) */}
      <header className="sticky top-0 z-40 bg-white/85 frost shadow-frost">
        <div className="max-w-md mx-auto md:max-w-2xl lg:max-w-6xl px-4 h-14 md:h-16 flex items-center gap-3">
          <Link href="/stamp-card" className="flex items-center gap-2.5 shrink-0" aria-label="Loyl home">
            <span className="w-9 h-9 rounded-lg bg-brand-green text-white grid place-items-center shadow-inset-light">
              <Stamp size={18} />
            </span>
            <span className="font-headline-sm text-headline-sm text-brand-green font-bold tracking-tight">
              Loyl
            </span>
          </Link>

          {/* Desktop top-nav */}
          <nav className="hidden md:flex items-center gap-1 ml-4" aria-label="Customer">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-label-lg text-label-lg transition-colors min-h-[44px] ${
                    isActive(item.href)
                      ? 'bg-brand-green text-white font-semibold shadow-inset-light'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                  }`}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
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
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 frost shadow-frost pb-[env(safe-area-inset-bottom)]"
        aria-label="Customer"
      >
        <div className="grid grid-cols-3 items-center h-16">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 h-16 transition-colors ${
                  isActive(item.href)
                    ? 'text-brand-green font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                aria-current={isActive(item.href) ? 'page' : undefined}
              >
                <Icon className="w-[22px] h-[22px]" />
                <span className="font-label-sm text-label-sm">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
};
