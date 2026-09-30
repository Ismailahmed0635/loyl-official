'use client';

import React from 'react';
import { Facebook, Globe, Instagram, Star } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';

/** Merchant Settings → social links, as the customer context exposes them. */
export interface ShopSocials {
  websiteUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
}

interface ShopLinksProps {
  businessName: string;
  /** Google Maps search URL for the shop (same one the bonus flow opens). */
  mapsUrl: string;
  socials: ShopSocials;
  /**
   * Stamp offers only: the PRD 3.3 bonus flow is live (the card exists and is
   * eligible). Then the button drives the open-Maps → claim-a-bonus-stamp
   * dance; on scratch/dice offers — or before a stamp card exists — it is a
   * plain link, so every offer page can send the customer to Google Reviews.
   */
  bonusEligible?: boolean;
  /** Stamp bonus flow: the customer already opened Maps from this card. */
  mapsOpened?: boolean;
  busy?: boolean;
  message?: { tone: 'ok' | 'bad'; text: string } | null;
  onOpenMaps?: () => void;
  onClaim?: () => void;
}

/**
 * The shop-level "review + follow" card shown under **every** offer type on
 * `/scan/[offerId]`: a prominent Google review button (bonus-claim aware on
 * stamp offers) plus the merchant's social links, so a customer can leave a
 * review and keep following the shop after their stamp/scratch/dice.
 */
export const ShopLinks: React.FC<ShopLinksProps> = ({
  businessName,
  mapsUrl,
  socials,
  bonusEligible = false,
  mapsOpened = false,
  busy = false,
  message = null,
  onOpenMaps,
  onClaim,
}) => {
  const links: Array<{ key: string; label: string; href: string; Icon: React.ComponentType<{ className?: string }> }> = [];
  if (socials.websiteUrl) links.push({ key: 'website', label: 'Website', href: socials.websiteUrl, Icon: Globe });
  if (socials.facebookUrl) links.push({ key: 'facebook', label: 'Facebook', href: socials.facebookUrl, Icon: Facebook });
  if (socials.instagramUrl) links.push({ key: 'instagram', label: 'Instagram', href: socials.instagramUrl, Icon: Instagram });

  const claimFlow = bonusEligible && mapsOpened && !!onClaim;
  const bonusFlow = bonusEligible && !claimFlow && !!onOpenMaps;

  return (
    <FadeUp>
      <Card className="p-5 flex flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-input bg-primary-fixed text-brand-green shrink-0">
            <Star size={18} />
          </span>
          <div>
            <p className="font-label-lg text-label-lg text-on-surface">Enjoyed this shop?</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
              {bonusFlow || claimFlow
                ? 'Rate them on Google Maps and earn a bonus stamp on your card.'
                : 'Rate them on Google — it takes a second and helps other shoppers find them.'}
            </p>
          </div>
        </div>

        {claimFlow ? (
          <Button variant="primary" className="w-full" isLoading={busy} onClick={onClaim}>
            I&apos;ve rated — claim my bonus stamp
          </Button>
        ) : bonusFlow ? (
          <Button
            variant="outline"
            className="w-full border-brand-green/30 text-brand-green hover:bg-primary-fixed/30"
            onClick={onOpenMaps}
            disabled={busy}
          >
            <Star className="w-4 h-4 mr-1.5" /> Rate us on Google Maps
          </Button>
        ) : (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-input border border-hairline bg-surface-container-lowest font-label-lg text-label-lg text-on-surface hover:bg-surface-container-low focus:outline-none focus:ring-2 focus:ring-brand-green transition-all select-none"
          >
            <Star className="w-4 h-4 text-brand-green" /> Rate us on Google
          </a>
        )}

        {message && (
          <p
            className={`font-body-sm text-body-sm font-medium ${
              message.tone === 'ok' ? 'text-brand-green' : 'text-brand-red'
            }`}
          >
            {message.text}
          </p>
        )}

        {links.length > 0 && (
          <div className="border-t border-hairline pt-3">
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Follow {businessName} for news and offers
            </p>
            <div className="flex gap-2 mt-2">
              {links.map(({ key, label, href, Icon }) => (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${businessName} on ${label}`}
                  title={label}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 rounded-input border border-hairline bg-surface-container-lowest font-body-sm text-body-sm font-semibold text-on-surface hover:bg-surface-container-low focus:outline-none focus:ring-2 focus:ring-brand-green transition-all select-none"
                >
                  <Icon className="w-4 h-4" /> <span className="hidden sm:inline">{label}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </Card>
    </FadeUp>
  );
};
