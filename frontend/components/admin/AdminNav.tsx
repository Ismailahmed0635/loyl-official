'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { logout } from '@/lib/api/client';
import { LayoutDashboard, LogOut, Receipt, ShieldCheck, Store } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/merchants', label: 'Merchants', icon: Store },
  { href: '/admin/billing', label: 'Billing', icon: Receipt },
] as const;

/** Desktop top-nav for the admin panel (the panel itself is desktop-only). */
export const AdminNav: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  async function handleLogout() {
    await logout();
    router.replace('/admin/login');
  }

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-white/85 frost shadow-frost">
      <div className="max-w-6xl mx-auto flex h-16 items-center justify-between gap-6 px-6">
        <Link href="/admin" className="flex items-center gap-2.5 shrink-0">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-green text-white shadow-inset-light">
            <ShieldCheck size={18} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-headline-sm text-headline-sm text-brand-green font-bold tracking-tight">
              Loyl
            </span>
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider mt-1">
              Admin
            </span>
          </span>
        </Link>

        <nav aria-label="Admin" className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 min-h-[44px] font-label-lg text-label-lg transition-colors ${
                isActive(item.href)
                  ? 'bg-brand-green text-white font-semibold shadow-inset-light'
                  : 'font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              <item.icon size={16} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden rounded-pill border border-hairline bg-surface-container-high px-3 py-1 font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant md:inline-flex">
            Super Admin
          </span>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut size={16} />
            <span className="ml-1.5">Log out</span>
          </Button>
        </div>
      </div>
    </header>
  );
};
