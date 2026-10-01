import React from 'react';
import { Smartphone } from 'lucide-react';
import {
  MENU_DEFAULT_BACKGROUND,
  contrastOn,
  normalizeHexColor,
  surfaceOn,
} from '@/lib/color';

/**
 * Interactive live preview of the digital menu (Phase 12 enhancement).
 *
 * Renders the exact customer view from `app/(public)/menu/[slug]/page.tsx`
 * (same background/foreground/surface maths, same section/item structure)
 * inside a mobile phone mockup, driven entirely by the editor's draft state.
 * Nothing here fetches or persists — the parent passes its live `title`,
 * `backgroundHex` and `categories` on every keystroke, so the frame updates
 * in real time. Modifier groups are intentionally not shown: the public page
 * does not render them either, so showing them here would break the
 * what-you-see-is-what-the-customer-gets contract.
 */

export interface PreviewItem {
  name: string;
  description: string;
  price: string;
  isAvailable: boolean;
}

export interface PreviewCategory {
  name: string;
  items: PreviewItem[];
}

interface MenuLivePreviewProps {
  title: string;
  businessName: string;
  backgroundHex: string;
  categories: PreviewCategory[];
}

export const MenuLivePreview: React.FC<MenuLivePreviewProps> = ({
  title,
  businessName,
  backgroundHex,
  categories,
}) => {
  const background = normalizeHexColor(backgroundHex) ?? MENU_DEFAULT_BACKGROUND;
  const foreground = contrastOn(background);
  const surface = surfaceOn(background);

  const heading = title.trim() || businessName;
  const visibleCategories = categories.filter(
    (c) => c.name.trim() || c.items.some((i) => i.name.trim())
  );
  const hasItems = visibleCategories.some((c) =>
    c.items.some((i) => i.name.trim())
  );

  return (
    <section aria-label="Live customer preview" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-h-[44px] items-center gap-1.5 font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
          <Smartphone className="h-4 w-4" aria-hidden="true" />
          Live preview
        </span>
        <span className="shrink-0 rounded-pill bg-primary-fixed px-2.5 py-0.5 font-label-sm text-label-sm uppercase text-on-primary-fixed">
          Customer view
        </span>
      </div>

      {/* Phone mockup frame */}
      <div className="mx-auto w-full max-w-[320px] rounded-panel border border-hairline bg-neutral-900 p-2 shadow-ambient">
        {/* Notch + status bar */}
        <div className="flex items-center justify-center pb-1.5 pt-0.5" aria-hidden="true">
          <span className="h-1.5 w-16 rounded-pill bg-neutral-700" />
        </div>
        {/* Screen — the customer page, scaled to a phone */}
        <div
          className="max-h-[560px] overflow-y-auto rounded-card px-4 py-5 font-body-md text-body-md antialiased"
          style={{ backgroundColor: background, color: foreground }}
        >
          <header className="pb-4">
            <p className="truncate font-label-sm text-label-sm uppercase tracking-wider opacity-70">
              {businessName}
            </p>
            <h1 className="mt-1 font-headline-sm text-headline-sm font-bold tracking-tight">
              {heading}
            </h1>
          </header>

          {hasItems ? (
            <div className="flex flex-col gap-5">
              {visibleCategories.map((category, ci) => {
                const items = category.items.filter((i) => i.name.trim());
                if (!category.name.trim() && items.length === 0) return null;
                return (
                  <section key={`${category.name}-${ci}`} className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 pl-0.5">
                      <span className="h-5 w-1 rounded-full bg-current" aria-hidden="true" />
                      <h2 className="truncate font-label-lg text-label-lg uppercase tracking-wide">
                        {category.name.trim() || `Section ${ci + 1}`}
                      </h2>
                    </div>
                    {items.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {items.map((item, ii) => (
                          <li
                            key={`${item.name}-${ii}`}
                            className="flex items-start justify-between gap-3 rounded-card p-3 shadow-hairline"
                            style={{ backgroundColor: surface }}
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-baseline gap-1.5">
                                <span
                                  className={`font-body-md text-body-md font-semibold ${
                                    item.isAvailable ? '' : 'line-through opacity-60'
                                  }`}
                                >
                                  {item.name.trim()}
                                </span>
                                {!item.isAvailable && (
                                  <span
                                    className="rounded-pill px-1.5 py-px font-label-sm text-label-sm uppercase tracking-wider font-semibold"
                                    style={{ backgroundColor: foreground, color: background }}
                                  >
                                    Sold out
                                  </span>
                                )}
                              </div>
                              {item.description.trim() && (
                                <p className="mt-0.5 line-clamp-2 font-body-sm text-body-sm opacity-75">
                                  {item.description.trim()}
                                </p>
                              )}
                            </div>
                            {item.price.trim() && (
                              <span
                                className={`shrink-0 whitespace-nowrap font-metric-num text-body-md font-bold tabular-nums ${
                                  item.isAvailable ? '' : 'opacity-60'
                                }`}
                              >
                                {item.price.trim()}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p
                        className="rounded-card px-3 py-2 text-center font-body-sm text-body-sm opacity-75"
                        style={{ backgroundColor: surface }}
                      >
                        No items yet
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <p
              className="rounded-card px-3 py-5 text-center font-body-sm text-body-sm"
              style={{ backgroundColor: surface }}
            >
              This menu is being updated. Please check back soon.
            </p>
          )}

          <footer
            className="mt-6 border-t pt-2.5 font-body-sm text-body-sm opacity-70"
            style={{ borderColor: surface }}
          >
            <p className="truncate">
              {businessName} · {heading}
            </p>
          </footer>
        </div>
      </div>
      <p className="text-center font-body-sm text-body-sm text-on-surface-variant">
        Updates as you type — this is what customers see after scanning your QR.
      </p>
    </section>
  );
};
