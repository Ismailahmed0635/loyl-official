'use client';

import React, { useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FadeUp } from '@/components/animations/FadeUp';
import {
  extractMenuPhoto,
  removeMenuPhoto,
  saveDigitalMenu,
  uploadMenuPhoto,
} from '@/lib/api/merchant';
import type {
  DigitalMenuRow,
  ExtractMenuResponse,
  MenuDraft,
  UploadMenuPhotoResponse,
} from '@/lib/api/merchant';
import type { SaveMenuInput } from '@/backend/validation/schemas';
import {
  MENU_MAX_CATEGORIES,
  MENU_MAX_CATEGORY_NAME,
  MENU_MAX_DESCRIPTION,
  MENU_MAX_ITEM_NAME,
  MENU_MAX_ITEMS_PER_CATEGORY,
  MENU_MAX_PRICE,
  MENU_MAX_TITLE,
} from '@/lib/constants';
import { MENU_DEFAULT_BACKGROUND, contrastOn, isHexColor, normalizeHexColor, surfaceOn } from '@/lib/color';
import { invalidate, prime } from '@/lib/api/cache';
import {
  AlertCircle,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Plus,
  Printer,
  Share2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

/**
 * Digital Menu editor (Phase 12).
 *
 * The merchant's whole flow lives on one screen: photograph the printed menu →
 * read it → correct it → pick a background → publish → get the QR. Nothing the
 * vision model returns is ever persisted on its own; this component holds the
 * draft until the merchant presses Save/Publish, which is what keeps a bad OCR
 * read a visible, correctable draft instead of a wrong public page.
 */

// Stable row identities so typing in one item can't re-key its neighbours.
let keySeq = 0;
const nextKey = () => `row-${(keySeq += 1)}`;

interface EditorItem {
  key: string;
  name: string;
  description: string;
  price: string;
  isAvailable: boolean;
  modifierGroups?: EditorModifierGroup[];
}

interface EditorModifierOption {
  key: string;
  name: string;
  price: string;
  isDefault: boolean;
}

interface EditorModifierGroup {
  key: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTI';
  isRequired: boolean;
  options: EditorModifierOption[];
}

interface EditorCategory {
  key: string;
  name: string;
  items: EditorItem[];
}

const blankItem = (): EditorItem => ({
  key: nextKey(),
  name: '',
  description: '',
  price: '',
  isAvailable: true,
  modifierGroups: [],
});

const blankCategory = (): EditorCategory => ({ key: nextKey(), name: '', items: [blankItem()] });

function categoriesFromRows(rows: DigitalMenuRow['categories']): EditorCategory[] {
  return rows.map((c) => ({
    key: nextKey(),
    name: c.name,
    items: c.items.map((i) => ({
      key: nextKey(),
      name: i.name,
      description: i.description ?? '',
      price: i.price ?? '',
      isAvailable: i.isAvailable,
      modifierGroups: (i.modifierGroups ?? []).map((g) => ({
        key: nextKey(),
        name: g.name,
        selectionType: g.selectionType,
        isRequired: g.isRequired ?? false,
        options: (g.options ?? []).map((o) => ({
          key: nextKey(),
          name: o.name,
          price: o.price ?? '',
          isDefault: o.isDefault ?? false,
        })),
      })),
    })),
  }));
}

/** Nothing typed yet — decides whether a fresh reading may replace the content. */
const isBlank = (cats: EditorCategory[]) =>
  cats.every(
    (c) =>
      !c.name.trim() &&
      c.items.every((i) => !i.name.trim() && !i.description.trim() && !i.price.trim())
  );

function toPayload(cats: EditorCategory[]): SaveMenuInput['categories'] {
  return cats.map((c) => ({
    name: c.name.trim(),
    items: c.items.map((i) => ({
      name: i.name.trim(),
      description: i.description.trim(),
      price: i.price.trim(),
      isAvailable: i.isAvailable,
      modifierGroups: i.modifierGroups?.map((g) => ({
        name: g.name,
        selectionType: g.selectionType,
        isRequired: g.isRequired,
        options: g.options?.map((o) => ({
          name: o.name,
          price: o.price,
          isDefault: o.isDefault,
        })) ?? [],
      })) ?? [],
    })),
  }));
}

/**
 * Client-side mirror of `saveMenuSchema`. Runs before any network call so the
 * merchant gets the message next to their button rather than as a 422 they
 * have to decode.
 */
function validate(title: string, backgroundHex: string, cats: EditorCategory[]): string | null {
  const t = title.trim();
  if (t.length < 2) return 'Menu title must be at least 2 characters.';
  if (t.length > MENU_MAX_TITLE)
    return `Menu title must be ${MENU_MAX_TITLE} characters or fewer.`;
  if (!isHexColor(backgroundHex)) return 'Background must be a hex colour such as #FFF7ED.';
  if (cats.length < 1) return 'Add at least one section to your menu.';
  if (cats.length > MENU_MAX_CATEGORIES)
    return `A menu can hold at most ${MENU_MAX_CATEGORIES} sections.`;

  for (let ci = 0; ci < cats.length; ci += 1) {
    const cat = cats[ci];
    const name = cat.name.trim();
    if (!name) return `Section ${ci + 1} needs a name.`;
    if (name.length > MENU_MAX_CATEGORY_NAME)
      return `Section names must be ${MENU_MAX_CATEGORY_NAME} characters or fewer.`;
    if (cat.items.length < 1) return `"${name}" needs at least one item — or delete the section.`;
    if (cat.items.length > MENU_MAX_ITEMS_PER_CATEGORY)
      return `A section can hold at most ${MENU_MAX_ITEMS_PER_CATEGORY} items.`;

    for (let ii = 0; ii < cat.items.length; ii += 1) {
      const it = cat.items[ii];
      if (!it.name.trim()) return `Item ${ii + 1} in "${name}" needs a name.`;
      if (it.name.trim().length > MENU_MAX_ITEM_NAME)
        return `Item names must be ${MENU_MAX_ITEM_NAME} characters or fewer.`;
      if (it.description.trim().length > MENU_MAX_DESCRIPTION)
        return `Descriptions must be ${MENU_MAX_DESCRIPTION} characters or fewer.`;
      if (it.price.trim().length > MENU_MAX_PRICE)
        return `Prices must be ${MENU_MAX_PRICE} characters or fewer.`;
    }
  }
  return null;
}

/** Swatches cover the common menu moods; the picker below allows any colour. */
const SWATCHES = [
  '#FFFFFF',
  '#FFF7ED',
  '#FEF3C7',
  '#ECFDF5',
  '#EFF6FF',
  '#FDF2F8',
  '#14532D',
  '#0F172A',
];

interface MenuEditorProps {
  initial: DigitalMenuRow | null;
  businessName: string;
}

/**
 * Numbered micro-header shared by the three editor cards (Sovereign Green:
 * badge + label-lg title + body-sm explainer, optional right-hand chip).
 */
function StepHeader({
  step,
  title,
  description,
  action,
}: {
  step: number;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-brand-green font-label-sm text-label-sm text-white">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="font-label-lg text-label-lg text-on-surface">{title}</h2>
          <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

/** Icon-only destructive control — 44px tap target, wine on hover. */
const ICON_BTN =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-input text-on-surface-variant transition-colors hover:bg-red-50 hover:text-brand-red focus:outline-none focus:ring-2 focus:ring-brand-red';

export const MenuEditor: React.FC<MenuEditorProps> = ({ initial, businessName }) => {
  const fileRef = useRef<HTMLInputElement>(null);

  const [menu, setMenu] = useState<DigitalMenuRow | null>(initial);
  const [url, setUrl] = useState<string | null>(initial?.url ?? null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(initial?.qrDataUrl ?? null);

  const [title, setTitle] = useState(initial?.title ?? businessName);
  const [backgroundHex, setBackgroundHex] = useState(
    initial?.backgroundHex ?? MENU_DEFAULT_BACKGROUND
  );
  const [categories, setCategories] = useState<EditorCategory[]>(() =>
    initial && initial.categories.length > 0 ? categoriesFromRows(initial.categories) : [blankCategory()]
  );

  const [uploading, setUploading] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Non-fatal setup message (e.g. no vision key) — the manual editor still works. */
  const [info, setInfo] = useState<string | null>(null);
  /** A reading that arrived while the editor already had content. */
  const [pendingDraft, setPendingDraft] = useState<MenuDraft | null>(null);
  const [copied, setCopied] = useState(false);

  const isLive = Boolean(menu?.publishedAt);

  // No "open the camera on arrival" here on purpose: a file chooser raised by a
  // programmatic click that carries no user gesture is silently ignored by
  // Chrome, so after a navigation it would never open. The Branch Page camera
  // icon (LOYLS §5) shoots and uploads first, and this button covers the rest.

  // --- Row editing ---------------------------------------------------------

  const updateCategory = (catKey: string, patch: Partial<EditorCategory>) =>
    setCategories((prev) => prev.map((c) => (c.key === catKey ? { ...c, ...patch } : c)));

  const updateItem = (catKey: string, itemKey: string, patch: Partial<EditorItem>) =>
    setCategories((prev) =>
      prev.map((c) =>
        c.key === catKey
          ? { ...c, items: c.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) }
          : c
      )
    );

  const addItem = (catKey: string) =>
    setCategories((prev) =>
      prev.map((c) => (c.key === catKey ? { ...c, items: [...c.items, blankItem()] } : c))
    );

  const removeItem = (catKey: string, itemKey: string) =>
    setCategories((prev) =>
      prev.map((c) =>
        c.key === catKey ? { ...c, items: c.items.filter((i) => i.key !== itemKey) } : c
      )
    );

  const addModifierGroup = (catKey: string, itemKey: string) =>
    setCategories((prev) =>
      prev.map((c) =>
        c.key === catKey
          ? {
              ...c,
              items: c.items.map((i) =>
                i.key === itemKey
                  ? {
                      ...i,
                      modifierGroups: [
                        ...(i.modifierGroups ?? []),
                        {
                          key: nextKey(),
                          name: '',
                          selectionType: 'SINGLE',
                          isRequired: false,
                          options: [],
                        },
                      ],
                    }
                  : i
              ),
            }
          : c
      )
    );

  const removeModifierGroup = (
    catKey: string,
    itemKey: string,
    groupKey: string
  ) =>
    setCategories((prev) =>
      prev.map((c) =>
        c.key === catKey
          ? {
              ...c,
              items: c.items.map((i) =>
                i.key === itemKey
                  ? {
                      ...i,
                      modifierGroups: (i.modifierGroups ?? []).filter(
                        (g) => g.key !== groupKey
                      ),
                    }
                  : i
              ),
            }
          : c
      )
    );

  const addModifierOption = (
    catKey: string,
    itemKey: string,
    groupKey: string
  ) =>
    setCategories((prev) =>
      prev.map((c) =>
        c.key === catKey
          ? {
              ...c,
              items: c.items.map((i) =>
                i.key === itemKey
                  ? {
                      ...i,
                      modifierGroups: (i.modifierGroups ?? []).map((g) =>
                        g.key === groupKey
                          ? {
                              ...g,
                              options: [
                                ...(g.options ?? []),
                                {
                                  key: nextKey(),
                                  name: '',
                                  price: '',
                                  isDefault: false,
                                },
                              ],
                            }
                          : g
                      ),
                    }
                  : i
              ),
            }
          : c
      )
    );

  const removeModifierOption = (
    catKey: string,
    itemKey: string,
    groupKey: string,
    optionKey: string
  ) =>
    setCategories((prev) =>
      prev.map((c) =>
        c.key === catKey
          ? {
              ...c,
              items: c.items.map((i) =>
                i.key === itemKey
                  ? {
                      ...i,
                      modifierGroups: (i.modifierGroups ?? []).map((g) =>
                        g.key === groupKey
                          ? {
                              ...g,
                              options: (g.options ?? []).filter(
                                (o) => o.key !== optionKey
                              ),
                            }
                          : g
                      ),
                    }
                  : i
              ),
            }
          : c
      )
    );

  const addCategory = () => setCategories((prev) => [...prev, blankCategory()]);
  const removeCategory = (catKey: string) =>
    setCategories((prev) => prev.filter((c) => c.key !== catKey));

  const updateModifierGroup = (
    catKey: string,
    itemKey: string,
    groupKey: string,
    patch: Partial<EditorModifierGroup>
  ) =>
    setCategories((prev) =>
      prev.map((c) =>
        c.key === catKey
          ? {
              ...c,
              items: c.items.map((i) =>
                i.key === itemKey
                  ? {
                      ...i,
                      modifierGroups: (i.modifierGroups ?? []).map((g) =>
                        g.key === groupKey ? { ...g, ...patch } : g
                      ),
                    }
                  : i
              ),
            }
          : c
      )
    );

  const updateModifierOption = (
    catKey: string,
    itemKey: string,
    groupKey: string,
    optionKey: string,
    patch: Partial<EditorModifierOption>
  ) =>
    setCategories((prev) =>
      prev.map((c) =>
        c.key === catKey
          ? {
              ...c,
              items: c.items.map((i) =>
                i.key === itemKey
                  ? {
                      ...i,
                      modifierGroups: (i.modifierGroups ?? []).map((g) =>
                        g.key === groupKey
                          ? {
                              ...g,
                              options: (g.options ?? []).map((o) =>
                                o.key === optionKey ? { ...o, ...patch } : o
                              ),
                            }
                          : g
                      ),
                    }
                  : i
              ),
            }
          : c
      )
    );

  // --- Reading a photo -----------------------------------------------------

  const applyDraft = (draft: MenuDraft) => {
    if (draft.categories.length > 0) {
      setCategories(
        draft.categories.map((c) => ({
          key: nextKey(),
          name: c.name,
          items: c.items.map((i) => ({
            key: nextKey(),
            name: i.name,
            description: i.description ?? '',
            price: i.price ?? '',
            isAvailable: true,
          })),
        }))
      );
    }
    const heading = draft.title?.trim();
    // Only take the heading when the merchant has not written their own yet.
    if (heading && (!title.trim() || title.trim() === businessName.trim())) setTitle(heading);
  };

  const countDraftItems = (draft: MenuDraft) =>
    draft.categories.reduce((sum, c) => sum + c.items.length, 0);

  const runExtract = async () => {
    setReading(true);
    setError(null);
    setInfo(null);
    setNotice(null);
    setPendingDraft(null);
    try {
      const res = await extractMenuPhoto();
      if (!res?.success) {
        const code = res?.error?.code;
        const message = res?.error?.message || 'Could not read the menu photo.';
        // Absent vision credentials are a supported state, not a failure:
        // the manual editor is the documented fallback.
        if (code === 'VISION_NOT_CONFIGURED') setInfo(message);
        else setError(message);
        return;
      }
      const draft = (res.data as ExtractMenuResponse).draft;
      if (draft.categories.length === 0) {
        setInfo('No menu items were found in that photo — add them below by hand.');
        return;
      }
      if (isBlank(categories)) {
        applyDraft(draft);
        setNotice(
          `We read ${countDraftItems(draft)} item${
            countDraftItems(draft) === 1 ? '' : 's'
          }. Check them over before publishing.`
        );
      } else {
        // Never silently overwrite work the merchant has already done.
        setPendingDraft(draft);
      }
    } catch {
      setError('Could not read the menu photo.');
    } finally {
      setReading(false);
    }
  };

  // --- Photo upload --------------------------------------------------------

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;

    setUploading(true);
    setError(null);
    setInfo(null);
    setNotice(null);
    setPendingDraft(null);
    try {
      const res = await uploadMenuPhoto(file);
      if (!res?.success) {
        setError(res?.error?.message || 'Could not upload that photo.');
        return;
      }
      const data = res.data as UploadMenuPhotoResponse;
      setMenu(data.menu);
      setUrl(data.menu.url ?? null);
      // The photo changed the row server-side — drop the cached copy so a
      // remount of /menu can't hand back a menu without it.
      invalidate('menu');
      await runExtract();
    } catch {
      setError('Could not upload that photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    setInfo(null);
    setError(null);
    try {
      const res = await removeMenuPhoto();
      if (!res?.success) {
        setError(res?.error?.message || 'Could not remove that photo.');
        return;
      }
      setMenu((prev) => (prev ? { ...prev, hasPhoto: false } : prev));
      invalidate('menu');
      setNotice('Photo removed. Your menu items are untouched.');
    } catch {
      setError('Could not remove that photo.');
    }
  };

  // --- Saving --------------------------------------------------------------

  const handleSave = async (publish: boolean) => {
    const problem = validate(title, backgroundHex, categories);
    if (problem) {
      setError(problem);
      setNotice(null);
      return;
    }
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await saveDigitalMenu({
        title: title.trim(),
        backgroundHex: normalizeHexColor(backgroundHex) ?? MENU_DEFAULT_BACKGROUND,
        categories: toPayload(categories),
        ...(publish ? { publish: true } : {}),
      });
      if (!res?.success) {
        setError(res?.error?.message || 'Could not save your menu.');
        return;
      }
      const data = res.data as { menu: DigitalMenuRow; businessName: string };
      setMenu(data.menu);
      if (data.menu.url) setUrl(data.menu.url);
      setQrDataUrl(data.menu.qrDataUrl ?? null);
      // Write the saved response straight into the cache: the next visit to
      // /menu shows what was just published without a round trip.
      prime('menu', { menu: data.menu, businessName: data.businessName });
      setNotice(
        publish && !isLive ? 'Your menu is live — the QR code below is ready to print.' : 'Menu saved.'
      );
    } catch {
      setError('Could not save your menu.');
    } finally {
      setSaving(false);
    }
  };

  // --- Share / download ----------------------------------------------------

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the URL is on screen anyway */
    }
  };

  const handleShare = async () => {
    if (!url) return;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: title || businessName, url });
        return;
      } catch {
        /* dismissed — fall through to copy */
      }
    }
    await handleCopy();
  };

  // --- Presentation --------------------------------------------------------

  const background = normalizeHexColor(backgroundHex) ?? MENU_DEFAULT_BACKGROUND;
  const foreground = contrastOn(background);
  const surface = surfaceOn(background);
  const itemCount = categories.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div className="flex flex-col gap-space-md">
      {/* Status + share */}
      <FadeUp>
        <Card className="p-0 overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-hairline bg-surface-container-low px-4 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-green/10 text-brand-green"
                aria-hidden="true"
              >
                <BookOpen className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h1 className="font-headline-sm text-headline-sm leading-tight text-on-surface">
                  Digital Menu
                </h1>
                <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
                  Photograph your printed menu, correct what we read, then publish a page customers
                  can open from a QR code — no app needed.
                </p>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-pill px-2.5 py-0.5 font-label-sm text-label-sm uppercase ${
                isLive ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              {isLive ? 'Live' : 'Draft'}
            </span>
          </div>

          {url && (
            <div className="px-4 py-3 sm:px-6">
              <div className="flex items-center gap-2 rounded-input border border-hairline bg-surface-container-low px-2 py-1.5">
                <ExternalLink className="ml-1 h-3.5 w-3.5 shrink-0 text-on-surface-variant" />
                <span className="min-w-0 flex-1 truncate font-body-sm text-body-sm text-on-surface-variant">
                  {url}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="min-h-[44px] shrink-0 rounded-input px-3 font-label-lg text-label-lg text-brand-green transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </Card>
      </FadeUp>

      {error && (
        <div className="flex items-start gap-2 rounded-card border border-error/30 bg-error-container px-4 py-3 text-body-md text-on-error-container">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-card border border-brand-green/20 bg-primary-fixed/50 px-4 py-3 text-body-md text-on-primary-fixed">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{notice}</p>
        </div>
      )}
      {info && (
        <div className="flex items-start gap-2 rounded-card border border-brand-amber/50 bg-amber-50 px-4 py-3 text-body-md text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{info}</p>
        </div>
      )}
      {pendingDraft && (
        <div className="flex flex-col gap-3 rounded-card border border-brand-amber/50 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-body-md text-body-md text-amber-900">
            A new reading is ready ({countDraftItems(pendingDraft)} items). Replace what is in the
            editor?
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                applyDraft(pendingDraft);
                setPendingDraft(null);
                setNotice('Items replaced with the new reading.');
              }}
            >
              Replace
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingDraft(null)}>
              Keep mine
            </Button>
          </div>
        </div>
      )}

      {/* Editor column (wide) + save / QR rail (narrow) on desktop */}
      <div className="flex flex-col gap-space-md lg:grid lg:grid-cols-3 lg:items-start lg:gap-space-md">
        <div className="flex min-w-0 flex-col gap-space-md lg:col-span-2">
          {/* 1. Photo */}
          <FadeUp>
            <Card className="flex flex-col gap-4 p-4 sm:p-5">
              <StepHeader
                step={1}
                title="Menu photo"
                description="Take a picture of your printed menu or pick one from your gallery."
              />

              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={handleFileChange}
              />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div
                  className="flex h-32 w-full shrink-0 items-center justify-center overflow-hidden rounded-card border border-hairline bg-surface-container-low sm:w-40"
                  aria-hidden={!menu?.hasPhoto}
                >
                  {menu?.hasPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src="/api/merchant/menu/photo"
                      alt="Your uploaded menu"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Camera className="h-7 w-7 text-outline-variant" />
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      onClick={() => fileRef.current?.click()}
                      isLoading={uploading}
                      className="flex-1"
                    >
                      <Camera className="mr-1.5 h-4 w-4" />
                      {menu?.hasPhoto ? 'Replace photo' : 'Add menu photo'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={runExtract}
                      isLoading={reading}
                      disabled={!menu?.hasPhoto}
                    >
                      <Sparkles className="mr-1.5 h-4 w-4" />
                      Read again
                    </Button>
                  </div>
                  {menu?.hasPhoto && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      className="min-h-[44px] self-start rounded-input text-label-lg text-brand-red transition-colors hover:underline focus:outline-none focus:ring-2 focus:ring-brand-red"
                    >
                      Remove photo
                    </button>
                  )}
                  <p className="font-body-sm text-body-sm text-on-surface-variant">
                    The photo is only used to read your menu — customers see the structured items,
                    not the picture.
                  </p>
                </div>
              </div>
            </Card>
          </FadeUp>

          {/* 2. Appearance */}
          <FadeUp>
            <Card className="flex flex-col gap-4 p-4 sm:p-5">
              <StepHeader
                step={2}
                title="Title & background"
                description="The text colour is chosen automatically so it stays readable on your background."
              />

              <Input
                label="Menu title"
                placeholder={businessName}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={MENU_MAX_TITLE + 10}
              />

              <div className="flex flex-col gap-2">
                <label
                  className="font-label-lg text-label-lg text-on-surface"
                  htmlFor="menu-bg"
                >
                  Background colour
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="menu-bg"
                    type="color"
                    value={background}
                    onChange={(e) => setBackgroundHex(normalizeHexColor(e.target.value) ?? background)}
                    className="h-11 w-14 shrink-0 cursor-pointer rounded-input border border-brand-border bg-white p-1"
                    aria-label="Pick a background colour"
                  />
                  <input
                    type="text"
                    value={backgroundHex}
                    onChange={(e) => setBackgroundHex(e.target.value)}
                    spellCheck={false}
                    className="min-h-[44px] w-32 rounded-input border border-brand-border bg-white px-3 font-mono text-body-md uppercase text-on-surface transition-all focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                    aria-label="Background colour hex value"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {SWATCHES.map((swatch) => (
                      <button
                        key={swatch}
                        type="button"
                        onClick={() => setBackgroundHex(swatch)}
                        aria-label={`Use ${swatch}`}
                        className={`h-11 w-11 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-brand-green focus:ring-offset-2 ${
                          background.toUpperCase() === swatch.toUpperCase()
                            ? 'border-brand-green'
                            : 'border-brand-border'
                        }`}
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </div>
                </div>
                {!isHexColor(backgroundHex) && (
                  <span className="font-body-sm text-body-sm font-medium text-brand-red">
                    Use a colour like #FFF7ED — 3 or 6 hex digits.
                  </span>
                )}
              </div>

              {/* Live preview so the merchant sees the real pairing before publishing. */}
              <div className="flex flex-col gap-1.5">
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                  Preview
                </span>
                <div
                  className="rounded-card p-4 text-body-md"
                  style={{ backgroundColor: background, color: foreground }}
                >
                  <p className="font-headline-sm text-headline-sm">
                    {title.trim() || businessName}
                  </p>
                  <div className="mt-2 rounded-lg p-3" style={{ backgroundColor: surface }}>
                    <p className="font-label-sm text-label-sm uppercase opacity-80">Section</p>
                    <div className="mt-1.5 flex justify-between gap-3">
                      <span>Sample item</span>
                      <span className="tnum font-semibold">৳250</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-3 opacity-75">
                      <span className="line-through">Sold out item</span>
                      <span className="tnum font-semibold">৳180</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </FadeUp>

          {/* 3. Items */}
          <FadeUp>
            <Card className="flex flex-col gap-4 p-4 sm:p-5">
              <StepHeader
                step={3}
                title="Menu items"
                description="Edit anything we read, then add what is missing."
                action={
                  <span className="shrink-0 font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
                    {itemCount} {itemCount === 1 ? 'item' : 'items'} listed
                  </span>
                }
              />

              <div className="flex flex-col gap-4">
                {categories.map((cat, ci) => (
                  <div
                    key={cat.key}
                    className="flex flex-col overflow-hidden rounded-card border border-hairline bg-white"
                  >
                    {/* Section header strip */}
                    <div className="flex items-center gap-2 border-b border-hairline bg-surface-container-low px-3 py-2">
                      <input
                        value={cat.name}
                        onChange={(e) => updateCategory(cat.key, { name: e.target.value })}
                        placeholder={`Section ${ci + 1} (e.g. Coffee)`}
                        maxLength={MENU_MAX_CATEGORY_NAME + 5}
                        aria-label={`Section ${ci + 1} name`}
                        className="min-h-[44px] flex-1 rounded-input border border-transparent bg-transparent px-2 text-label-lg text-on-surface placeholder:text-on-surface-variant/70 focus:border-brand-green focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-green"
                      />
                      <span className="shrink-0 rounded-pill bg-primary-fixed/70 px-2 py-0.5 font-label-sm text-label-sm text-on-primary-fixed">
                        {cat.items.length} {cat.items.length === 1 ? 'item' : 'items'}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCategory(cat.key)}
                        aria-label={`Delete section ${ci + 1}`}
                        className={ICON_BTN}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="divide-y divide-hairline">
                      {cat.items.map((item) => (
                        <div
                          key={item.key}
                          className={`flex flex-col gap-2 p-3 transition-colors sm:flex-row sm:items-start ${
                            item.isAvailable
                              ? 'hover:bg-surface-container-low/60'
                              : 'bg-red-50/40'
                          }`}
                        >
                          <div className="flex flex-1 flex-col gap-2">
                            <input
                              value={item.name}
                              onChange={(e) =>
                                updateItem(cat.key, item.key, { name: e.target.value })
                              }
                              placeholder="Item name"
                              maxLength={MENU_MAX_ITEM_NAME + 5}
                              aria-label="Item name"
                              className="min-h-[48px] w-full rounded-input border border-brand-border bg-white px-3 text-body-md text-on-surface transition-all placeholder:text-on-surface-variant/50 focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                            />
                            <input
                              value={item.description}
                              onChange={(e) =>
                                updateItem(cat.key, item.key, { description: e.target.value })
                              }
                              placeholder="Description (optional)"
                              maxLength={MENU_MAX_DESCRIPTION + 20}
                              aria-label="Item description"
                              className="min-h-[44px] w-full rounded-input border border-brand-border bg-white px-3 text-body-sm text-on-surface-variant transition-all placeholder:text-on-surface-variant/50 focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              value={item.price}
                              onChange={(e) => updateItem(cat.key, item.key, { price: e.target.value })}
                              placeholder="৳000"
                              maxLength={MENU_MAX_PRICE + 5}
                              aria-label="Item price"
                              className="min-h-[44px] w-24 rounded-input border border-brand-border bg-white px-3 text-label-lg tabular-nums text-on-surface transition-all placeholder:text-on-surface-variant/50 focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(cat.key, item.key)}
                              aria-label={`Delete ${item.name || 'item'}`}
                              className={ICON_BTN}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              value={item.price}
                              onChange={(e) => updateItem(cat.key, item.key, { price: e.target.value })}
                              placeholder="৳000"
                              maxLength={MENU_MAX_PRICE + 5}
                              aria-label="Item price"
                              className="min-h-[44px] w-24 rounded-input border border-brand-border bg-white px-3 text-label-lg tabular-nums text-on-surface transition-all placeholder:text-on-surface-variant/50 focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(cat.key, item.key)}
                              aria-label={`Delete ${item.name || 'item'}`}
                              className={ICON_BTN}
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-input border border-hairline bg-white px-3 font-body-sm text-body-sm text-on-surface-variant">
                            <input
                              type="checkbox"
                              checked={item.isAvailable}
                              onChange={(e) =>
                                updateItem(cat.key, item.key, { isAvailable: e.target.checked })
                              }
                              className="h-4 w-4 accent-brand-green"
                            />
                            Available
                          </label>
                          {/* Add-ons button */}
                          {expandedItem === item.key ? (
                            <div className="mt-2 pt-2 border-t border-hairline bg-surface-container-low">
                              <Button size="sm" variant="ghost" onClick={() => setExpandedItem(null)}>
                                <X className="mr-1 h-3.5 w-3.5" /> Close
                              </Button>
                              <div className="grid grid-cols-2 gap-2 text-body-sm">
                                <div>
                                  <label className="block text-caption sm:text-body-xs mb-1">
                                    Modifier group name
                                  </label>
                                  <Input
                                    placeholder="e.g. Size"
                                    value={item.modifierGroups?.[0]?.name ?? ''}
                                    onChange={(e) => {
                                      const groupKey = item.modifierGroups?.[0]?.key;
                                      if (groupKey)
                                        updateModifierGroup(cat.key, item.key, groupKey, {
                                          name: e.target.value,
                                        });
                                    }}
                                  />
                                </div>
                                <div>
                                  <label className="block text-caption sm:text-body-xs mb-1">
                                    Selection type
                                  </label>
                                  <div className="flex gap-2">
                                    <label>
                                      <input
                                        type="radio"
                                        name={`modifier-type-${item.key}`}
                                        value="SINGLE"
                                        checked={(item.modifierGroups?.[0]?.selectionType ?? 'SINGLE') !== 'MULTI'}
                                        onChange={() => {
                                          const groupKey = item.modifierGroups?.[0]?.key;
                                          if (groupKey)
                                            updateModifierGroup(cat.key, item.key, groupKey, {
                                              selectionType: 'SINGLE',
                                            });
                                        }}
                                      />
                                      SINGLE
                                    </label>
                                    <label>
                                      <input
                                        type="radio"
                                        name={`modifier-type-${item.key}`}
                                        value="MULTI"
                                        checked={item.modifierGroups?.[0]?.selectionType === 'MULTI'}
                                        onChange={() => {
                                          const groupKey = item.modifierGroups?.[0]?.key;
                                          if (groupKey)
                                            updateModifierGroup(cat.key, item.key, groupKey, {
                                              selectionType: 'MULTI',
                                            });
                                        }}
                                      />
                                      MULTI
                                    </label>
                                  </div>
                                </div>
                              </div>
                              {/* Options grid */}
                              <div className="mt-3 pt-3 border-t border-hairline bg-white">
                                {item.modifierGroups?.map((group, gi) => (
                                  <div key={group.key} className="mb-2">
                                    <div className="flex items-center justify-between text-body-sm">
                                      <span className="font-medium">{group.name || 'New group'}</span>
                                      <Button
                                        size="sm"
                        variant="ghost"
                        onClick={() => removeModifierGroup(cat.key, item.key, group.key)}
                        aria-label={`Remove ${group.name || 'modifier group'} from item`}
                      >
                                        <X className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                    {group.selectionType === 'SINGLE' ? (
                                      <div className="grid grid-cols-3 gap-2 text-caption sm:text-body-xs">
                                        {group.options?.map((option, oi) => (
                                          <div key={option.key} className="flex flex-col">
                                            <Input
                                              placeholder="+৳0"
                                              value={option.price || ''}
                                              onChange={(e) =>
                                                updateModifierOption(
                                                  cat.key,
                                                  item.key,
                                                  group.key,
                                                  option.key,
                                                  { price: e.target.value }
                                                )
                                              }
                                            />
                                            <div className="flex items-center gap-2">
                                              <span className="font-caption">{option.name || 'Option'}</span>
                                              <label className="checkbox checkbox-sm">
                                                <input
                                                  type="radio"
                                                  name={`option-default-${item.key}-${group.key}`}
                                                  checked={option.isDefault}
                                                  onChange={() =>
                                                    updateModifierOption(
                                                      cat.key,
                                                      item.key,
                                                      group.key,
                                                      option.key,
                                                      { isDefault: true }
                                                    )
                                                  }
                                                />
                                                <span className="caption-text">Default</span>
                                              </label>
                                            </div>
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => removeModifierOption(cat.key, item.key, group.key, option.key)}
                                                aria-label={`Remove ${option.name || 'option'} from group`}
                                              >
                                                <X className="h-3.5 w-3.5" />
                                              </Button>
                                            </div>
                                          ))}
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => addModifierOption(cat.key, item.key, group.key)}
                                        >
                                          <Plus className="mr-1 h-3.5 w-3.5" /> Add option
                                        </Button>
                                      </div>
                                    ) : (
                                      <div className="grid grid-cols-2 gap-2 text-caption sm:text-body-xs">
                                        {group.options?.map((option, oi) => (
                                          <div key={option.key} className="flex flex-col">
                                            <Input
                                              placeholder="Topping name"
                                              value={option.name || ''}
                                              onChange={(e) =>
                                                updateModifierOption(
                                                  cat.key,
                                                  item.key,
                                                  group.key,
                                                  option.key,
                                                  { name: e.target.value }
                                                )
                                              }
                                            />
                                            <span className="font-caption">{option.name || 'Topping'}</span>
                                            <Input
                                              placeholder="+৳0"
                                              value={option.price || ''}
                                              onChange={(e) =>
                                                updateModifierOption(
                                                  cat.key,
                                                  item.key,
                                                  group.key,
                                                  option.key,
                                                  { price: e.target.value }
                                                )
                                              }
                                            />
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => removeModifierOption(cat.key, item.key, group.key, option.key)}
                                              aria-label={`Remove ${option.name || 'option'} from group`}
                                            >
                                              <X className="h-3.5 w-3.5" />
                                            </Button>
                                              </div>
                                          ))}
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => addModifierOption(cat.key, item.key, group.key)}
                                        >
                                          <Plus className="mr-1 h-3.5 w-3.5" /> Add option
                                        </Button>
                                      </div>
                                    )}
                                    <label className="mt-2 block text-caption sm:text-body-xs">
                                      <input
                                        type="checkbox"
                                        checked={group.isRequired}
                                        onChange={(e) =>
                                          updateModifierGroup(cat.key, item.key, group.key, {
                                            isRequired: e.target.checked,
                                          })
                                        }
                                      />
                                      Required (MULTI groups always optional — selecting this will be ignored)
                                    </label>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setExpandedItem(item.key)}
                              className="min-h-[44px] text-label-lg text-brand-green transition-colors hover:bg-primary-fixed/30 focus:outline-none focus:ring-2 focus:ring-brand-green"
                            >
                              <Sparkles className="mr-1.5 h-4 w-4" /> Add-ons
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => addItem(cat.key)}
                      className="min-h-[44px] border-t border-hairline bg-white text-label-lg text-brand-green transition-colors hover:bg-surface-container-low focus:outline-none focus:ring-2 focus:ring-brand-green focus:ring-inset"
                    >
                      <Plus className="mr-1.5 inline h-4 w-4" /> Add item
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addCategory}
                className="min-h-[48px] rounded-card border-2 border-dashed border-brand-border bg-white text-label-lg text-on-surface-variant transition-colors hover:border-brand-green hover:bg-primary-fixed/30 hover:text-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green"
              >
                <Plus className="mr-1.5 inline h-4 w-4" /> Add section
              </button>
            </Card>
          </FadeUp>
        </div>

        {/* Save / publish + QR rail */}
        <div className="flex min-w-0 flex-col gap-space-md lg:col-span-1">
          <FadeUp>
            <Card className="flex flex-col gap-3 p-4 sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={() => handleSave(false)}
                  isLoading={saving}
                  className="flex-1"
                >
                  Save draft
                </Button>
                <Button
                  variant="primary"
                  onClick={() => handleSave(true)}
                  isLoading={saving}
                  className="flex-1"
                >
                  {isLive ? 'Save changes' : 'Publish menu'}
                </Button>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                {isLive
                  ? 'Changes go live as soon as you save.'
                  : 'Publishing creates your public page and unlocks the QR code below.'}
              </p>
            </Card>
          </FadeUp>

          {/* QR */}
          {isLive && qrDataUrl && url && (
            <FadeUp>
              <Card className="flex flex-col items-center gap-4 border-transparent bg-brand-green p-4 text-white shadow-ambient sm:p-5">
                <div className="w-full text-center">
                  <h2 className="font-headline-sm text-headline-sm text-white">Your QR code</h2>
                  <p className="mt-1 font-body-sm text-body-sm text-white/75">
                    Print it on your counter, menu board or receipts.
                  </p>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrDataUrl}
                  alt="QR code linking to your digital menu"
                  className="w-56 max-w-full rounded-card border border-white/20 bg-white p-2.5"
                />
                <div className="grid w-full grid-cols-2 gap-space-sm">
                  <Button
                    variant="outline"
                    onClick={handleCopy}
                    className="border-transparent bg-white text-brand-green hover:bg-primary-fixed"
                  >
                    {copied ? (
                      <>
                        <Check className="mr-1.5 h-4 w-4 text-brand-green" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1.5 h-4 w-4" /> Copy Link
                      </>
                    )}
                  </Button>
                  <a
                    href={qrDataUrl}
                    download={`loyl-menu-${menu?.slug ?? 'qr'}.png`}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-input bg-white px-4 py-2.5 text-label-lg text-brand-green shadow-inset-light transition-all hover:bg-primary-fixed focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-brand-green"
                  >
                    <Download className="mr-1.5 h-4 w-4" /> Download PNG
                  </a>
                  <Button
                    variant="outline"
                    onClick={() => window.print()}
                    className="border-transparent bg-white text-brand-green hover:bg-primary-fixed"
                  >
                    <Printer className="mr-1.5 h-4 w-4" /> Print / PDF
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleShare}
                    className="border-transparent bg-white text-brand-green hover:bg-primary-fixed focus:ring-white"
                  >
                    <Share2 className="mr-1.5 h-4 w-4" /> Share
                  </Button>
                </div>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-1.5 text-label-lg text-white underline-offset-4 hover:underline focus:outline-none focus:ring-2 focus:ring-white"
                >
                  Open your menu <ExternalLink className="h-4 w-4" />
                </a>
              </Card>
            </FadeUp>
          )}
        </div>
      </div>
    </div>
  );
};
