'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Merchant } from '@prisma/client';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { FadeUp } from '@/components/animations/FadeUp';
import type { SettingsResponse } from '@/lib/api/merchant';
import { getSettings, updateSettings } from '@/lib/api/merchant';
import { useQuery, prime } from '@/lib/api/cache';
import { BUSINESS_CATEGORIES } from '@/lib/constants';
import { AlertCircle, CheckCircle2, MapPin, Phone, Save } from 'lucide-react';

interface FormValues {
  businessName: string;
  category: string;
  logoUrl: string;
  websiteUrl: string;
  facebookUrl: string;
  instagramUrl: string;
}

const EMPTY_FORM: FormValues = {
  businessName: '',
  category: BUSINESS_CATEGORIES[0],
  logoUrl: '',
  websiteUrl: '',
  facebookUrl: '',
  instagramUrl: '',
};

const URL_KEYS: Array<keyof FormValues> = ['logoUrl', 'websiteUrl', 'facebookUrl', 'instagramUrl'];

function isValidOptionalUrl(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const SUBSCRIPTION_LABEL: Record<string, { label: string; tone: string }> = {
  PENDING: { label: 'Payment pending', tone: 'bg-surface-container-high text-on-surface-variant' },
  ACTIVE: { label: 'Subscription active', tone: 'bg-primary-fixed text-on-primary-fixed' },
  EXPIRED: { label: 'Subscription expired', tone: 'bg-error-container text-on-error-container' },
};

const SELECT_CLASS =
  'w-full min-h-[44px] px-4 py-2.5 bg-surface-container-lowest border border-brand-border rounded-input text-on-surface font-body-md text-body-md focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent transition-all';

export default function SettingsPage() {
  const router = useRouter();

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Cached read; the form below is seeded from it whenever a *new* response
  // lands (never on re-render), so a background revalidation can't clobber
  // keystrokes the merchant is mid-way through typing.
  const { data: settingsData, error: loadErrorRaw, isLoading, refetch } =
    useQuery<SettingsResponse>(
      'settings',
      async () => {
        const res = await getSettings();
        if (!res?.success) {
          throw new Error(res?.error?.message || 'Failed to load settings');
        }
        return res.data as SettingsResponse;
      },
      { ttl: 60_000 }
    );

  const loading = isLoading;
  const loadError = loadErrorRaw
    ? loadErrorRaw instanceof Error
      ? loadErrorRaw.message
      : String(loadErrorRaw)
    : '';
  const load = refetch;

  /** Persists a successful save so the shell's name updates without a re-fetch. */
  const writeSettingsCache = (payload: SettingsResponse) => prime('settings', payload);

  useEffect(() => {
    const m = settingsData?.merchant;
    if (!m) return;
    setMerchant(m);
    setForm((prev) => {
      // Already seeded from this merchant — keep whatever the merchant typed.
      if (prev.businessName && prev.businessName === m.businessName) return prev;
      return {
        businessName: m.businessName,
        category: m.category,
        logoUrl: m.logoUrl ?? '',
        websiteUrl: m.websiteUrl ?? '',
        facebookUrl: m.facebookUrl ?? '',
        instagramUrl: m.instagramUrl ?? '',
      };
    });
  }, [settingsData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const businessName = form.businessName.trim();
    if (businessName.length < 2) {
      setFormError('Business name must be at least 2 characters');
      return;
    }
    if (!form.category.trim()) {
      setFormError('Please select a business category');
      return;
    }
    for (const key of URL_KEYS) {
      if (!isValidOptionalUrl(form[key])) {
        setFormError(`${key === 'logoUrl' ? 'Logo' : key === 'websiteUrl' ? 'Website' : key === 'facebookUrl' ? 'Facebook' : 'Instagram'} link must be a valid URL (or empty)`);
        return;
      }
    }

    setSaving(true);
    try {
      const res = await updateSettings({
        businessName,
        category: form.category.trim(),
        logoUrl: form.logoUrl.trim(),
        websiteUrl: form.websiteUrl.trim(),
        facebookUrl: form.facebookUrl.trim(),
        instagramUrl: form.instagramUrl.trim(),
      });
      if (res?.success) {
        setMerchant((res.data as SettingsResponse).merchant);
        // Persist the saved response so the shell's business name updates now
        // rather than on the next cold visit.
        writeSettingsCache(res.data as SettingsResponse);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
      } else {
        setFormError(res?.error?.message || 'Failed to save settings');
      }
    } catch {
      setFormError('Network error saving settings.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-space-lg" aria-busy="true">
        <div className="h-10 bg-surface-container-lowest rounded-card border border-hairline shadow-hairline" />
        <div className="h-72 bg-surface-container-lowest rounded-card border border-hairline shadow-hairline" />
        <div className="h-40 bg-surface-container-lowest rounded-card border border-hairline shadow-hairline" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <div className="flex items-center gap-2 text-brand-red">
          <AlertCircle className="w-5 h-5" />
          <p className="font-body-md text-body-md font-medium">{loadError}</p>
        </div>
        <button
          onClick={load}
          className="min-h-[44px] px-4 rounded-input bg-brand-green text-white text-sm font-semibold shadow-inset-light hover:bg-brand-greenDark transition-colors"
        >
          Try again
        </button>
      </Card>
    );
  }

  // Keep a stored category that is no longer in the preset list selectable.
  const categoryOptions = BUSINESS_CATEGORIES.includes(form.category as never)
    ? BUSINESS_CATEGORIES
    : ([...BUSINESS_CATEGORIES, form.category] as readonly string[]);

  const subscription = merchant ? SUBSCRIPTION_LABEL[merchant.subscriptionStatus] : undefined;

  return (
    <div className="flex flex-col gap-space-lg">
      <FadeUp>
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">Settings</h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Your business profile, social links, and account details.
          </p>
        </div>
      </FadeUp>

      {saved && (
        <p
          className="font-body-sm text-body-sm text-brand-green font-medium flex items-center gap-1.5"
          role="status"
        >
          <CheckCircle2 className="w-4 h-4" /> Settings saved.
        </p>
      )}

      {/* Profile + social links (LOYLS §6) */}
      <FadeUp>
        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-space-md">
            <p className="font-headline-sm text-headline-sm text-on-surface">Business Profile</p>

            <Input
              label="Business Name *"
              placeholder="e.g. Crimson Cup Banani"
              value={form.businessName}
              onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
              required
            />

            <div className="w-full flex flex-col gap-1.5">
              <label
                className="font-label-lg text-label-lg text-on-surface"
                htmlFor="settings-category"
              >
                Business Category *
              </label>
              <select
                id="settings-category"
                className={SELECT_CLASS}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Logo URL"
              placeholder="https://example.com/logo.png"
              value={form.logoUrl}
              onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
              helperText="Cloudinary or web URL of your brand logo"
            />

            <p className="font-headline-sm text-headline-sm text-on-surface pt-1">Social Links</p>

            <Input
              label="Website"
              placeholder="https://example.com"
              value={form.websiteUrl}
              onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
            />
            <Input
              label="Facebook"
              placeholder="https://facebook.com/yourshop"
              value={form.facebookUrl}
              onChange={(e) => setForm((f) => ({ ...f, facebookUrl: e.target.value }))}
            />
            <Input
              label="Instagram"
              placeholder="https://instagram.com/yourshop"
              value={form.instagramUrl}
              onChange={(e) => setForm((f) => ({ ...f, instagramUrl: e.target.value }))}
            />

            {formError && (
              <p className="font-body-md text-body-md text-brand-red font-medium" role="alert">
                {formError}
              </p>
            )}

            <Button type="submit" variant="accent" isLoading={saving}>
              <Save className="w-4 h-4 mr-1.5" /> Save Changes
            </Button>
          </form>
        </Card>
      </FadeUp>

      {/* Map location (LOYLS §6) — coordinates live on each branch */}
      <FadeUp>
        <Card className="flex flex-col items-start gap-2 bg-surface-container-low border-hairline">
          <p className="font-label-lg text-label-lg text-on-surface flex items-center gap-2">
            <MapPin className="w-4 h-4 text-brand-green" /> Map location
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Your shop&apos;s map pins are managed per branch — add or correct GPS coordinates so
            nearby customers can check in.
          </p>
          <Button size="sm" variant="outline" onClick={() => router.push('/branches')}>
            Manage Branch Locations
          </Button>
        </Card>
      </FadeUp>

      {/* Account */}
      {merchant && (
        <FadeUp>
          <Card className="flex flex-col gap-3">
            <p className="font-headline-sm text-headline-sm text-on-surface">Account</p>
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 font-body-md text-body-md text-on-surface-variant tabular-nums">
                <Phone className="w-4 h-4" /> {merchant.phoneNumber}
              </span>
              {subscription && (
                <span
                  className={`px-2.5 py-0.5 rounded-pill font-label-sm text-label-sm uppercase ${subscription.tone}`}
                >
                  {subscription.label}
                </span>
              )}
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant tabular-nums">
              Member since {new Date(merchant.createdAt).toISOString().slice(0, 10)} · Your phone
              number is your sign-in and can&apos;t be changed here.
            </p>
          </Card>
        </FadeUp>
      )}
    </div>
  );
}
