/**
 * backend/menu.ts — Phase 12 Digital Menu Card.
 *
 * Two halves live here, deliberately kept free of `next/*` so both are unit
 * testable without a server:
 *
 *   1. **Presentation maths** — slug generation for the public `/menu/{slug}`
 *      URL, hex normalisation for the merchant-chosen background, and the
 *      WCAG luminance swap that decides black-on-colour vs white-on-colour.
 *      The merchant picks any colour they like; the customer still has to be
 *      able to read it.
 *
 *   2. **Photo → draft extraction** — one call to a Vision API (Groq Llama 4
 *      Scout preferred, OpenAI fallback) using Node's own `fetch` (no new
 *      dependency), plus a tolerant parser that turns whatever the model
 *      returns into a validated draft for the merchant to correct. The
 *      merchant is always the last editor: nothing extracted here is ever
 *      published without them saving it.
 *
 * File IO is intentionally NOT here — photo storage reuses the existing
 * size-capped helpers in `backend/billing.ts` (see `MENU_PHOTO_DIR`).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { visionDraftSchema, type MenuDraft } from '@/backend/validation/schemas';
import { detectImageKind, imageKindMatchesExt } from '@/backend/billing';
import {
  MENU_DEFAULT_BACKGROUND,
  normalizeHexColor,
  relativeLuminance,
  contrastOn,
  surfaceOn,
} from '@/lib/color';
import {
  MENU_SLUG_MAX,
  MENU_SLUG_FALLBACK,
  MENU_MAX_CATEGORIES,
  MENU_MAX_ITEMS_PER_CATEGORY,
  MENU_MAX_TITLE,
  MENU_MAX_CATEGORY_NAME,
  MENU_MAX_ITEM_NAME,
  MENU_MAX_DESCRIPTION,
  MENU_MAX_PRICE,
  MENU_MAX_MODIFIER_GROUPS_PER_ITEM,
  MENU_MAX_OPTIONS_PER_GROUP,
  MENU_MAX_MODIFIER_GROUP_NAME,
  MENU_MAX_MODIFIER_OPTION_NAME,
  MENU_MAX_MODIFIER_PRICE,
} from '@/lib/constants';

// Re-exported so callers and tests can import the whole feature from one place.
export {
  // Colour maths lives in lib/color.ts because the merchant editor previews it
  // client-side too; re-exported here so backend consumers need one import.
  MENU_DEFAULT_BACKGROUND,
  normalizeHexColor,
  relativeLuminance,
  contrastOn,
  surfaceOn,
  MENU_SLUG_MAX,
  MENU_SLUG_FALLBACK,
  MENU_MAX_CATEGORIES,
  MENU_MAX_ITEMS_PER_CATEGORY,
  MENU_MAX_TITLE,
  MENU_MAX_CATEGORY_NAME,
  MENU_MAX_ITEM_NAME,
  MENU_MAX_DESCRIPTION,
  MENU_MAX_PRICE,
  MENU_MAX_MODIFIER_GROUPS_PER_ITEM,
  MENU_MAX_OPTIONS_PER_GROUP,
  MENU_MAX_MODIFIER_GROUP_NAME,
  MENU_MAX_MODIFIER_OPTION_NAME,
  MENU_MAX_MODIFIER_PRICE,
};

// --- Shared query + wire shape ----------------------------------------------

/**
 * Categories and items always come back in display order. Modifier groups and
 * their options (Phase 12.5) ride along — the editor edits them in place, and
 * the public page needs them to show what a customer can pick.
 */
export const menuInclude = {
  categories: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' as const },
        include: {
          modifierGroups: {
            orderBy: { sortOrder: 'asc' as const },
            include: { options: { orderBy: { sortOrder: 'asc' as const } } },
          },
        },
      },
    },
  },
} satisfies Prisma.DigitalMenuInclude;

export type MenuWithCategories = Prisma.DigitalMenuGetPayload<{ include: typeof menuInclude }>;

/**
 * The menu as the HTTP surface returns it. Shared by the GET/PUT route and the
 * photo route so a client never has to merge two different shapes of the same
 * row — ids and timestamps are included because the editor keeps them for the
 * life of the session.
 */
export function serializeMenu(menu: MenuWithCategories) {
  return {
    id: menu.id,
    slug: menu.slug,
    title: menu.title,
    backgroundHex: menu.backgroundHex,
    hasPhoto: Boolean(menu.photoPath),
    publishedAt: menu.publishedAt,
    createdAt: menu.createdAt,
    updatedAt: menu.updatedAt,
    categories: menu.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      sortOrder: cat.sortOrder,
      items: cat.items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        sortOrder: item.sortOrder,
        isAvailable: item.isAvailable,
        modifierGroups: item.modifierGroups.map((group) => ({
          id: group.id,
          name: group.name,
          selectionType: group.selectionType,
          isRequired: group.isRequired,
          sortOrder: group.sortOrder,
          options: group.options.map((option) => ({
            id: option.id,
            name: option.name,
            price: option.price,
            isDefault: option.isDefault,
            sortOrder: option.sortOrder,
          })),
        })),
      })),
    })),
  };
}

export type SerializedMenu = ReturnType<typeof serializeMenu>;

// --- Photo storage ----------------------------------------------------------

/** Storage root for uploaded menu photos (never served publicly).
 * Same `STORAGE_DIR` contract as billing screenshots: set it to a persistent
 * mount in production, leave unset for local dev. */
export const MENU_PHOTO_DIR = path.join(
  process.env.STORAGE_DIR || process.cwd(),
  process.env.STORAGE_DIR ? 'menu-photos' : path.join('storage', 'menu-photos')
);
export const MENU_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

// Production misconfiguration alarm: menu photos would land on the ephemeral
// container filesystem and vanish on redeploy until STORAGE_DIR mounts a volume.
if (process.env.NODE_ENV === 'production' && !process.env.STORAGE_DIR) {
  console.warn(
    'STORAGE_DIR is unset — menu photos use ephemeral repo-root storage/ and vanish on redeploy. Mount a persistent volume.'
  );
}

/** Minimal file shape so tests don't need the DOM `File` type (mirrors billing). */
export interface UploadLike {
  type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Validation failure for an uploaded menu photo (routes map this to 422 + code). */
export class MenuUploadError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'MenuUploadError';
  }
}

/** Allowed upload types → canonical extension/content-type. */
export const MENU_PHOTO_MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

/**
 * Validates and persists a menu photo; returns its bare filename.
 * Throws BEFORE anything is written, so a rejected upload never leaves an
 * orphan file behind.
 */
export async function saveMenuPhoto(
  file: UploadLike,
  dir: string = MENU_PHOTO_DIR
): Promise<string> {
  const ext = file.type ? MENU_PHOTO_MIME_EXT[file.type.toLowerCase()] : undefined;
  if (!ext) {
    throw new MenuUploadError('Menu photo must be a PNG, JPEG, WebP or HEIC image.', 'INVALID_FILE_TYPE');
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new MenuUploadError('Menu photo file is empty.', 'EMPTY_FILE');
  }
  if (buffer.byteLength > MENU_PHOTO_MAX_BYTES) {
    throw new MenuUploadError('Menu photo must be 5MB or smaller.', 'FILE_TOO_LARGE');
  }
  // SEC-07: polyglot rejection — same rule as payment screenshots.
  const kind = detectImageKind(buffer);
  if (!kind || !imageKindMatchesExt(kind, ext)) {
    throw new MenuUploadError(
      'File content does not match its declared image type.',
      'INVALID_FILE_TYPE'
    );
  }
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}${ext}`;
  await writeFile(path.join(dir, name), buffer);
  return name;
}

/** Best-effort, path-traversal safe removal — only a bare filename is unlinked. */
export async function deleteMenuPhoto(
  fileName: string | null | undefined,
  dir: string = MENU_PHOTO_DIR
): Promise<boolean> {
  if (!fileName) return false;
  const safe = path.basename(fileName);
  if (safe !== fileName) return false;
  try {
    await rm(path.join(dir, safe), { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Reads a stored menu photo; null when missing/unknown. */
export async function readMenuPhoto(
  fileName: string | null | undefined,
  dir: string = MENU_PHOTO_DIR
): Promise<{ data: Buffer; contentType: string } | null> {
  if (!fileName) return null;
  const safe = path.basename(fileName);
  if (safe !== fileName) return null;
  const contentType = Object.entries(MENU_PHOTO_MIME_EXT).find(([, e]) => e === path.extname(safe).toLowerCase())?.[0];
  if (!contentType) return null;
  try {
    return { data: await readFile(path.join(dir, safe)), contentType };
  } catch {
    return null;
  }
}

/** Base64 of a stored photo for the vision request; null when it is gone. */
export async function menuPhotoAsBase64(fileName: string | null | undefined): Promise<{
  base64: string;
  contentType: string;
} | null> {
  const file = await readMenuPhoto(fileName);
  if (!file) return null;
  return { base64: file.data.toString('base64'), contentType: file.contentType };
}

// --- Slug (the public /menu/{slug} handle) ----------------------------------

/**
 * Lowercase ASCII handle for a business name.
 * Diacritics are folded rather than dropped, non-ASCII (including Bengali
 * script) collapses to separators, and the result is trimmed so it can never
 * start or end with `-`. Returns '' when nothing usable survives.
 */
export function slugify(input: string | null | undefined): string {
  if (typeof input !== 'string') return '';
  // Strip combining marks (U+0300–U+036F) left behind by NFKD, by code point
  // rather than by a literal range — a regex range here is unreadable in source.
  const stripMarks = (s: string) =>
    Array.from(s)
      .filter((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code < 0x0300 || code > 0x036f;
      })
      .join('');

  return stripMarks(input.normalize('NFKD'))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MENU_SLUG_MAX)
    .replace(/-+$/g, '');
}

/** `slugify` that never returns '' — the public URL always resolves to something. */
export function baseSlug(input: string | null | undefined): string {
  return slugify(input) || MENU_SLUG_FALLBACK;
}

/** How many `-2`, `-3`, … suffixes are tried before falling back to a random tail. */
export const SLUG_ATTEMPTS = 25;

/**
 * First free handle derived from a business name: `cafe-corner`,
 * `cafe-corner-2`, `cafe-corner-3`, …
 *
 * `isTaken` is injected rather than imported so this stays free of the Prisma
 * client and is trivially unit-testable; each candidate is probed first, so a
 * slug collision resolves to the next suffix instead of a unique-constraint
 * violation surfacing as a 500.
 */
export async function allocateSlug(
  businessName: string | null | undefined,
  isTaken: (slug: string) => Promise<boolean>
): Promise<string> {
  const base = baseSlug(businessName).slice(0, MENU_SLUG_MAX);
  // `n <= SLUG_ATTEMPTS` so the last numbered handle (`-25`) is probed too; the
  // old `n < SLUG_ATTEMPTS` never asked about it and then jumped straight past
  // it, leaving a permanent gap in the sequence.
  for (let n = 0; n <= SLUG_ATTEMPTS; n += 1) {
    const candidate = slugWithSuffix(base, n);
    if (!(await isTaken(candidate))) return candidate;
  }
  // Every handle in the budget is taken. Keep probing outward instead of
  // returning a candidate we never checked: committing an unprobed tail is how
  // a full list turns into a unique-constraint violation on every save from
  // then on (the collision is deterministic, so it never self-heals).
  for (let n = SLUG_ATTEMPTS + 1; n < SLUG_ATTEMPTS * 10; n += 1) {
    const candidate = slugWithSuffix(base, n);
    if (!(await isTaken(candidate))) return candidate;
  }
  // Practically unreachable — the suffix still keeps it within MENU_SLUG_MAX.
  return slugWithSuffix(base, SLUG_ATTEMPTS * 10 + 1);
}

/**
 * `cafe-corner`, `cafe-corner-2`, `cafe-corner-3`, …
 * The suffix is budgeted against MENU_SLUG_MAX so the result always fits the
 * column, and a trailing dash left by truncation is trimmed off.
 */
export function slugWithSuffix(base: string, n: number): string {
  if (n <= 0) return base;
  const suffix = `-${n}`;
  const room = MENU_SLUG_MAX - suffix.length;
  return `${base.slice(0, Math.max(1, room)).replace(/-+$/, '')}${suffix}`;
}

// --- Background colour ------------------------------------------------------
//
// `normalizeHexColor`, `relativeLuminance`, `contrastOn` and `surfaceOn` live
// in `lib/color.ts` (re-exported above) because the merchant editor renders
// the same pairing client-side as a live preview while choosing. One
// implementation, two consumers.

// --- Vision extraction ------------------------------------------------------

export class VisionNotConfiguredError extends Error {
  readonly code = 'VISION_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'VisionNotConfiguredError';
  }
}

export class VisionError extends Error {
  readonly code = 'VISION_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'VisionError';
  }
}

/** Model used unless OPENAI_VISION_MODEL overrides it. Cheap + strong on photos. */
export const MENU_VISION_MODEL = 'gpt-4o-mini';
export const OPENAI_VISION_URL = 'https://api.openai.com/v1/chat/completions';
/** Groq OpenAI-compatible endpoint + default vision model (Llama 4 Scout). */
export const GROQ_VISION_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
/** Extraction is one round trip on a large image — bound it hard. */
export const VISION_TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = [
  'You read photos of restaurant/cafe menus and return JSON only.',
  'Group items into the menu sections they appear under, preserving reading order.',
  'Keep item names and descriptions verbatim — do not translate, invent or merge items.',
  'Prices are display strings: keep the currency symbol exactly as printed.',
  'An item with no printed price gets price null. Never guess a price.',
  'Return {"title": string|null, "categories":[{"name": string, "items":',
  '[{"name": string, "description": string|null, "price": string|null}]}]}.',
  'If the image is not a menu, return {"title": null, "categories": []}.',
].join(' ');

/** Pull the first balanced JSON object out of a model reply (fences or not). */
export function extractJsonObject(raw: string | null | undefined): unknown | null {
  if (typeof raw !== 'string') return null;
  const unfenced = raw.replace(/```(?:json)?/gi, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Validated, size-bounded draft the merchant edits before publishing. The type
 * itself lives in `backend/validation/schemas.ts` alongside the rest of the
 * feature's contracts; it is re-exported here so this module stays the one
 * import for extraction code.
 *
 * Built by `toMenuDraft`, which strips unknown model keys rather than
 * rejecting them — this is upstream output, not a client request, so a new
 * field from the model must never fail an extraction.
 */
export type { MenuDraft };

const clip = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

/** Normalise a parsed model payload into a `MenuDraft` the schema guarantees. */
export function toMenuDraft(raw: unknown): MenuDraft {
  const parsed = visionDraftSchema.safeParse(raw);
  if (!parsed.success) throw new VisionError('The menu photo could not be read.');
  const src = parsed.data;

  const categories: MenuDraft['categories'] = [];
  for (const cat of src.categories.slice(0, MENU_MAX_CATEGORIES)) {
    const name = clip(cat.name, MENU_MAX_CATEGORY_NAME);
    if (!name) continue;
    const items = cat.items
      .slice(0, MENU_MAX_ITEMS_PER_CATEGORY)
      .map((it) => ({
        name: clip(it.name, MENU_MAX_ITEM_NAME),
        description: clip(it.description, MENU_MAX_DESCRIPTION) || null,
        price: clip(it.price, MENU_MAX_PRICE) || null,
      }))
      .filter((it) => it.name.length > 0);
    // A heading with nothing under it is noise, not a section.
    if (items.length === 0) continue;
    categories.push({ name, items });
  }

  return { title: clip(src.title, MENU_MAX_TITLE) || null, categories };
}

/** Model reply → validated draft. Throws VisionError on unparseable output. */
export function parseVisionJson(raw: string | null | undefined): MenuDraft {
  const json = extractJsonObject(raw);
  if (json === null) throw new VisionError('The menu photo could not be read.');
  return toMenuDraft(json);
}

function isProviderAuthError(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

/** Resolved vision provider — Groq wins when both keys are set. */
export interface VisionConfig {
  provider: 'groq' | 'openai';
  url: string;
  apiKey: string;
  model: string;
}

/**
 * Picks the vision provider from env. Groq (`GROQ_API_KEY`) is checked first
 * so merchants can use the fast/cheap path without removing the OpenAI key;
 * OpenAI (`OPENAI_API_KEY`) remains as fallback. Throws
 * `VisionNotConfiguredError` when neither is set — the UI falls back to the
 * manual editor, which is a supported end state.
 */
export function resolveVisionConfig(): VisionConfig {
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  if (groqKey) {
    const groqModel = (process.env.GROQ_VISION_MODEL || '').trim() || GROQ_VISION_MODEL;
    return { provider: 'groq', url: GROQ_VISION_URL, apiKey: groqKey, model: groqModel };
  }
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (openaiKey) {
    const openaiModel = (process.env.OPENAI_VISION_MODEL || '').trim() || MENU_VISION_MODEL;
    return { provider: 'openai', url: OPENAI_VISION_URL, apiKey: openaiKey, model: openaiModel };
  }
  throw new VisionNotConfiguredError(
    'Menu photo recognition is not configured on this server. Add the items below by hand.'
  );
}

/**
 * Runs the stored photo through the vision model and returns a draft.
 *
 * Throws:
 *  - `VisionNotConfiguredError` (503) when neither GROQ_API_KEY nor
 *    OPENAI_API_KEY is set — the UI falls back to the manual editor, which
 *    is a supported end state.
 *  - `VisionError` (502) on any transport, auth or parse failure.
 */
export async function extractMenuDraft(input: {
  base64: string;
  contentType: string;
  businessName: string;
}): Promise<MenuDraft> {
  const config = resolveVisionConfig();
  const { apiKey, model } = config;

  let res: Response;
  try {
    res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Menu for: ${input.businessName}` },
              {
                type: 'image_url',
                image_url: { url: `data:${input.contentType};base64,${input.base64}` },
              },
            ],
          },
        ],
      }),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(VISION_TIMEOUT_MS) : undefined,
    });
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|abort/i.test(err.name + err.message);
    throw new VisionError(
      timedOut ? 'Menu recognition timed out. Try a sharper photo or add items by hand.'
        : 'Could not reach the menu recognition service.'
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('Menu vision request failed', config.provider, res.status, body.slice(0, 400));
    throw new VisionError(
      isProviderAuthError(res.status)
        ? 'Menu recognition was rejected by the provider. Check the API key or try again later.'
        : 'Menu recognition failed. Please try again.'
    );
  }

  let content: unknown;
  try {
    const payload = await res.json();
    content = payload?.choices?.[0]?.message?.content;
  } catch {
    throw new VisionError('Menu recognition returned an unreadable response.');
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new VisionError('No menu was recognised in that photo.');
  }

  return parseVisionJson(content);
}
