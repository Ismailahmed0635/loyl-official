import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  allocateSlug,
  baseSlug,
  extractJsonObject,
  parseVisionJson,
  saveMenuPhoto,
  deleteMenuPhoto,
  readMenuPhoto,
  slugWithSuffix,
  slugify,
  toMenuDraft,
  extractMenuDraft,
  resolveVisionConfig,
  VisionError,
  VisionNotConfiguredError,
  MenuUploadError,
  MENU_SLUG_MAX,
  MENU_MAX_CATEGORIES,
  MENU_MAX_ITEMS_PER_CATEGORY,
  MENU_MAX_ITEM_NAME,
  MENU_MAX_CATEGORY_NAME,
  SLUG_ATTEMPTS,
} from './menu';

// --- Slug --------------------------------------------------------------------

describe('slugify — public /menu/{slug} handle', () => {
  it('folds diacritics instead of dropping them', () => {
    expect(slugify('Café Corner')).toBe('cafe-corner');
    expect(slugify('Crème Brûlée Bar')).toBe('creme-brulee-bar');
  });

  it('collapses punctuation and whitespace runs into single dashes', () => {
    expect(slugify('  Happy   Hours!!  ')).toBe('happy-hours');
    expect(slugify('Mama & Papa\'s Pizza')).toBe('mama-papa-s-pizza');
  });

  it('keeps digits (chain names like "Cafe 24")', () => {
    expect(slugify('Cafe 24')).toBe('cafe-24');
  });

  it('returns an empty string when no ASCII survives (Bengali-only names)', () => {
    expect(slugify('কাফে কর্নার')).toBe('');
  });

  it('never returns leading/trailing dashes and never exceeds the column', () => {
    const long = slugify(`-${'a'.repeat(120)}-`);
    expect(long.startsWith('-')).toBe(false);
    expect(long.endsWith('-')).toBe(false);
    expect(long.length).toBeLessThanOrEqual(MENU_SLUG_MAX);
  });

  it('handles non-string input without throwing', () => {
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
    expect(slugify(42 as unknown as string)).toBe('');
  });

  it('baseSlug always yields something the URL can resolve to', () => {
    expect(baseSlug('Café Corner')).toBe('cafe-corner');
    expect(baseSlug('')).toBe('menu');
    expect(baseSlug('কাফে কর্নার')).toBe('menu');
  });
});

describe('slugWithSuffix — collision walk', () => {
  it('is the plain base at n = 0', () => {
    expect(slugWithSuffix('cafe-corner', 0)).toBe('cafe-corner');
  });

  it('appends -2, -3, …', () => {
    expect(slugWithSuffix('cafe-corner', 2)).toBe('cafe-corner-2');
    expect(slugWithSuffix('cafe-corner', 11)).toBe('cafe-corner-11');
  });

  it('budgets the suffix against the max length and trims a cut-off dash', () => {
    const base = 'a'.repeat(MENU_SLUG_MAX);
    const result = slugWithSuffix(base, 2);
    expect(result.length).toBeLessThanOrEqual(MENU_SLUG_MAX);
    expect(result.endsWith('-2')).toBe(true);
    expect(result).not.toMatch(/--$/);
  });
});

describe('allocateSlug — probes the unique column before committing', () => {
  it('returns the base when nothing has taken it', async () => {
    expect(await allocateSlug('Café Corner', async () => false)).toBe('cafe-corner');
  });

  it('walks to the first free suffix (GitHub-style -1, -2, …)', async () => {
    const taken = new Set(['cafe-corner', 'cafe-corner-1', 'cafe-corner-2']);
    expect(await allocateSlug('Café Corner', async (s) => taken.has(s))).toBe('cafe-corner-3');
  });

  it('falls back to the generic handle for a name with no ASCII', async () => {
    expect(await allocateSlug('কাফে কর্নার', async () => false)).toBe('menu');
  });

  it('always terminates, even when every candidate is somehow taken', async () => {
    const slug = await allocateSlug('Café Corner', async () => true);
    expect(slug.length).toBeLessThanOrEqual(MENU_SLUG_MAX);
    expect(slug.startsWith('cafe-corner')).toBe(true);
  });

  it('probes every handle it considers, including the last of the budget', async () => {
    const taken = new Set<string>(['cafe-corner']);
    for (let n = 1; n <= SLUG_ATTEMPTS; n += 1) taken.add(`cafe-corner-${n}`);

    const probed: string[] = [];
    const slug = await allocateSlug('Café Corner', async (candidate) => {
      probed.push(candidate);
      return taken.has(candidate);
    });

    // Regression: `n < SLUG_ATTEMPTS` never asked about `-25`, then returned
    // `-26` unprobed. Once `-26` also existed, every subsequent save for that
    // business name failed on the unique constraint — deterministically, so it
    // never self-healed.
    expect(probed).toContain('cafe-corner-25');
    expect(slug).toBe('cafe-corner-26');
    expect(taken.has(slug)).toBe(false);
  });
});

// --- Vision parsing ----------------------------------------------------------

describe('extractJsonObject — tolerant model-reply parsing', () => {
  it('unwraps a fenced block', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('finds the object inside surrounding prose', () => {
    expect(extractJsonObject('Sure! Here it is: {"a":1} — enjoy.')).toEqual({ a: 1 });
  });

  it('returns null instead of throwing on unusable input', () => {
    expect(extractJsonObject('no braces here')).toBeNull();
    expect(extractJsonObject('{ not closed')).toBeNull();
    expect(extractJsonObject(null)).toBeNull();
    expect(extractJsonObject(undefined)).toBeNull();
  });
});

describe('toMenuDraft / parseVisionJson — bounded, schema-safe drafts', () => {
  it('accepts an empty payload as an empty draft', () => {
    expect(toMenuDraft({})).toEqual({ title: null, categories: [] });
  });

  it('rejects a non-object payload', () => {
    expect(() => toMenuDraft('hello')).toThrow(VisionError);
    expect(() => parseVisionJson('no json')).toThrow(VisionError);
  });

  it('caps the number of categories and items per category', () => {
    const draft = toMenuDraft({
      title: 'T',
      categories: Array.from({ length: MENU_MAX_CATEGORIES + 5 }, (_, ci) => ({
        name: `Section ${ci}`,
        items: Array.from({ length: MENU_MAX_ITEMS_PER_CATEGORY + 20 }, (_, ii) => ({
          name: `Item ${ii}`,
          description: null,
          price: null,
        })),
      })),
    });

    expect(draft.categories).toHaveLength(MENU_MAX_CATEGORIES);
    expect(draft.categories[0].items).toHaveLength(MENU_MAX_ITEMS_PER_CATEGORY);
  });

  it('clips over-long names and drops nameless rows', () => {
    const draft = toMenuDraft({
      title: 'T',
      categories: [
        {
          name: 'Coffee',
          items: [
            { name: 'x'.repeat(MENU_MAX_ITEM_NAME + 40), description: null, price: null },
            { name: '   ', description: null, price: null },
            { name: '', description: null, price: null },
          ],
        },
        { name: '   ', items: [{ name: 'Latte', description: null, price: null }] },
      ],
    });

    expect(draft.categories).toHaveLength(1);
    expect(draft.categories[0].items).toHaveLength(1);
    expect(draft.categories[0].items[0].name).toHaveLength(MENU_MAX_ITEM_NAME);
  });

  it('keeps a heading only when it has at least one usable item', () => {
    const draft = toMenuDraft({
      categories: [{ name: 'Coffee', items: [{ name: '', description: null, price: null }] }],
    });
    expect(draft.categories).toEqual([]);
  });

  it('never invents a price the model did not supply', () => {
    const draft = toMenuDraft({
      categories: [
        {
          name: 'Coffee',
          items: [{ name: 'Latte', description: 'Hot', price: null }],
        },
      ],
    });
    expect(draft.categories[0].items[0].price).toBeNull();
  });

  it('drops unknown model keys rather than failing the extraction', () => {
    const draft = toMenuDraft({
      title: 'T',
      categories: [{ name: 'Coffee', items: [{ name: 'Latte' }], confidence: 0.9 }],
      usage: { total_tokens: 123 },
    });
    expect(draft.categories[0]).toEqual({
      name: 'Coffee',
      items: [{ name: 'Latte', description: null, price: null }],
    });
  });

  it('reads a realistic fenced model reply end to end', () => {
    const raw = '```json\n' + JSON.stringify({
      title: 'Bistro Menu',
      categories: [
        { name: 'Coffee', items: [{ name: 'Latte', description: 'Hot', price: '৳250' }] },
      ],
    }) + '\n```';

    expect(parseVisionJson(raw)).toEqual({
      title: 'Bistro Menu',
      categories: [
        { name: 'Coffee', items: [{ name: 'Latte', description: 'Hot', price: '৳250' }] },
      ],
    });
  });

  it('clips the category name against the shared cap', () => {
    const draft = toMenuDraft({
      categories: [{ name: 'x'.repeat(MENU_MAX_CATEGORY_NAME + 30), items: [{ name: 'A' }] }],
    });
    expect(draft.categories[0].name).toHaveLength(MENU_MAX_CATEGORY_NAME);
  });
});

describe('extractMenuDraft — configuration gate', () => {
  const originalOpenaiKey = process.env.OPENAI_API_KEY;
  const originalGroqKey = process.env.GROQ_API_KEY;
  const originalGroqModel = process.env.GROQ_VISION_MODEL;

  afterEach(() => {
    if (originalOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenaiKey;
    if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalGroqKey;
    if (originalGroqModel === undefined) delete process.env.GROQ_VISION_MODEL;
    else process.env.GROQ_VISION_MODEL = originalGroqModel;
  });

  it('raises VISION_NOT_CONFIGURED (not a crash) when no key is set', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    await expect(
      extractMenuDraft({ base64: 'AAAA', contentType: 'image/jpeg', businessName: 'Cafe' })
    ).rejects.toBeInstanceOf(VisionNotConfiguredError);
  });

  it('prefers Groq when both keys are set', () => {
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.GROQ_API_KEY = 'groq-key';
    expect(resolveVisionConfig().provider).toBe('groq');
  });

  it('falls back to OpenAI when only the OpenAI key is set', () => {
    delete process.env.GROQ_API_KEY;
    process.env.OPENAI_API_KEY = 'openai-key';
    expect(resolveVisionConfig().provider).toBe('openai');
  });
});

// --- Photo storage -----------------------------------------------------------

describe('photo storage — validates before writing', () => {
  let dir = '';

  const makeDir = async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'loyl-menu-'));
    return dir;
  };

  const upload = (type: string, bytes: Uint8Array) => ({
    type,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('stores a PNG under a bare filename', async () => {
    const target = await makeDir();
    const png12 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const name = await saveMenuPhoto(upload('image/png', png12), target);
    expect(path.isAbsolute(name)).toBe(false);
    expect(name.endsWith('.png')).toBe(true);

    const file = await readMenuPhoto(name, target);
    expect(file?.contentType).toBe('image/png');
    expect(file?.data.length).toBe(12);

    expect(await deleteMenuPhoto(name, target)).toBe(true);
    expect(await readMenuPhoto(name, target)).toBeNull();
  });

  it('rejects an unsupported type without creating a file', async () => {
    const target = await makeDir();
    await expect(
      saveMenuPhoto(upload('application/pdf', new Uint8Array([1])), target)
    ).rejects.toMatchObject({ code: 'INVALID_FILE_TYPE' });
  });

  it('rejects an empty file', async () => {
    const target = await makeDir();
    await expect(
      saveMenuPhoto(upload('image/jpeg', new Uint8Array(0)), target)
    ).rejects.toMatchObject({ code: 'EMPTY_FILE' });
  });

  it('refuses path traversal — only a bare filename is ever touched', async () => {
    expect(await readMenuPhoto('../../etc/passwd', await makeDir())).toBeNull();
    expect(await deleteMenuPhoto('../secrets.env', dir)).toBe(false);
    expect(await readMenuPhoto(null, dir)).toBeNull();
  });

  it('surfaces a typed error routes can map to 422', async () => {
    const target = await makeDir();
    const err = await saveMenuPhoto(upload('text/plain', new Uint8Array([1])), target).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(MenuUploadError);
  });

  it('SEC-07: rejects a script wearing image/png (content mismatch)', async () => {
    const target = await makeDir();
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0, 0, 0, 0, 0]); // %PDF-
    await expect(saveMenuPhoto(upload('image/png', pdf), target)).rejects.toMatchObject({
      code: 'INVALID_FILE_TYPE',
    });
    expect(await readdir(target)).toEqual([]);
  });
});
