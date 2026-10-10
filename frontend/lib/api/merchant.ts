import type { Offer, Branch, Merchant, ScratchItem } from '@prisma/client';
import type {
  CreateOfferInput,
  UpdateOfferInput,
  UpdateScratchOfferInput,
  UpdateDiceOfferInput,
  BranchInput,
  UpdateBranchInput,
  UpdateSettingsInput,
  SaveMenuInput,
  MenuDraft,
} from '@/backend/validation/schemas';
import { invalidate } from '@/lib/api/cache';

// Re-exported so components can type drafts from this module alone.
export type { MenuDraft, MenuDraftCategory, MenuDraftItem } from '@/backend/validation/schemas';

// --- Types -----------------------------------------------------------------

/** An offer together with its scratch reward rows (empty for stamp offers). */
export type OfferWithItems = Offer & { scratchItems: ScratchItem[] };

export interface MerchantStats {
  offerCount: number;
  activeOfferCount: number;
  branchCount: number;
  customerCount: number;
  stampsCollected: number;
  totalRedeemed: number;
}

export interface StatsResponse {
  merchant: Merchant;
  stats: MerchantStats;
}

export interface OfferQrResponse {
  offer: OfferWithItems;
  merchant: Pick<Merchant, 'id' | 'businessName' | 'category' | 'logoUrl' | 'phoneNumber'>;
  scanUrl: string;
  qrDataUrl: string;
}

// --- Helpers ---------------------------------------------------------------

/** fetch() has no default timeout — bound every wrapper so pages can't hang. */
const API_TIMEOUT_MS = 15_000;

async function request(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  return res.json();
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Every cached read that a mutation can make stale.
 *
 * The dashboard is the main one: it renders offers, branches, stats and the
 * business name, so *any* write to those changes what it should show. Doing
 * this in one place means no page can forget to invalidate, and it costs
 * nothing — an invalidated key refetches on next read rather than now.
 */
function invalidateReads(...keys: string[]): void {
  invalidate('dashboard', ...keys);
}

// --- Merchant stats --------------------------------------------------------

export async function getMerchantStats() {
  return request('/api/merchant/stats');
}

// --- Offers ----------------------------------------------------------------

export async function listOffers() {
  return request('/api/offers');
}

/** Creates a Stamp, Scratch, or Dice offer (`offerType` picks the engine). */
export async function createOffer(data: CreateOfferInput) {
  const res = await request('/api/offers', json('POST', data));
  if (res?.success) invalidateReads();
  return res;
}

export async function getOffer(id: string) {
  return request(`/api/offers/${id}`);
}

/** PATCH — the body shape depends on the offer's (immutable) type. */
export async function updateOffer(
  id: string,
  data: UpdateOfferInput | UpdateScratchOfferInput | UpdateDiceOfferInput
) {
  const res = await request(`/api/offers/${id}`, json('PATCH', data));
  if (res?.success) invalidateReads(`offer:${id}`);
  return res;
}

export async function deleteOffer(id: string) {
  const res = await request(`/api/offers/${id}`, { method: 'DELETE' });
  if (res?.success) invalidateReads(`offer:${id}`);
  return res;
}

export async function getOfferQr(id: string) {
  return request(`/api/offers/${id}/qr`);
}

// --- Branches --------------------------------------------------------------

export async function listBranches() {
  return request('/api/branches');
}

export async function createBranch(data: BranchInput) {
  const res = await request('/api/branches', json('POST', data));
  if (res?.success) invalidateReads('branches');
  return res;
}

export async function updateBranch(id: string, data: UpdateBranchInput) {
  const res = await request(`/api/branches/${id}`, json('PATCH', data));
  if (res?.success) invalidateReads('branches');
  return res;
}

export async function deleteBranch(id: string) {
  const res = await request(`/api/branches/${id}`, { method: 'DELETE' });
  if (res?.success) invalidateReads('branches');
  return res;
}

// --- Phase 4: Analytics & Settings ------------------------------------------

export interface AnalyticsRange {
  from: string;
  to: string;
  days: number;
}

export interface AnalyticsSeriesPoint {
  date: string;
  scans: number;
  reviewBonuses: number;
  redeems: number;
  scratchReveals: number;
  diceRolls: number;
  newCustomers: number;
  uniqueVisitors: number;
}

export interface AnalyticsTotals {
  scans: number;
  reviewBonuses: number;
  redeems: number;
  scratchReveals: number;
  diceRolls: number;
  newCustomers: number;
  returningCustomers: number;
  uniqueVisitors: number;
  redemptionRate: number;
}

export interface OfferPerformance {
  offerId: string;
  title: string;
  offerType: 'STAMP' | 'SCRATCH' | 'DICE';
  scans: number;
  reviewBonuses: number;
  redeems: number;
  scratchReveals: number;
  diceRolls: number;
  uniqueVisitors: number;
}

export interface AnalyticsResponse {
  range: AnalyticsRange;
  totals: AnalyticsTotals;
  series: AnalyticsSeriesPoint[];
  offers: OfferPerformance[];
  generatedAt: string;
}

export interface CustomerRow {
  /** `CustomerStamp.id`, `scan:<phone>`, `scratch:<phone>` or `dice:<phone>` depending on which source made the row. */
  id: string;
  customerPhone: string;
  /** Phase 12: the name captured at check-in; null when never supplied. */
  customerName: string | null;
  stampsCollected: number;
  totalRedeemed: number;
  /**
   * Phase 12: every check-in this phone ever made (approved history plus any
   * still waiting) — the per-scan tracking number, distinct from
   * `stampsCollected` which only counts approved stamps.
   */
  scanCount: number;
  /** Phase 12: check-ins still awaiting the merchant's approval. */
  pendingCount: number;
  lastScannedAt: string | null;
  lastReviewAt: string | null;
  createdAt: string;
}

export interface CustomerListResponse {
  customers: CustomerRow[];
  stats: { totalCustomers: number };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface SettingsResponse {
  merchant: Merchant;
}

function rangeQuery(params?: { from?: string; to?: string }): string {
  const search = new URLSearchParams();
  if (params?.from) search.set('from', params.from);
  if (params?.to) search.set('to', params.to);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/** GET /api/merchant/analytics for the given range (default: last 30 days). */
export async function getAnalytics(params?: { from?: string; to?: string }) {
  return request(`/api/merchant/analytics${rangeQuery(params)}`);
}

/** URL for the CSV download of the current range (Content-Disposition attachment). */
export function analyticsCsvUrl(params?: { from?: string; to?: string }): string {
  const qs = new URLSearchParams({ format: 'csv' });
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  return `/api/merchant/analytics?${qs.toString()}`;
}

/** GET /api/merchant/customers — search (`q`) + pagination. */
export async function listCustomers(params?: { q?: string; page?: number; pageSize?: number }) {
  const search = new URLSearchParams();
  if (params?.q) search.set('q', params.q);
  if (params?.page) search.set('page', String(params.page));
  if (params?.pageSize) search.set('pageSize', String(params.pageSize));
  const qs = search.toString();
  return request(`/api/merchant/customers${qs ? `?${qs}` : ''}`);
}

// --- Settings ----------------------------------------------------------------

export async function getSettings() {
  return request('/api/merchant/settings');
}

export async function updateSettings(data: UpdateSettingsInput) {
  const res = await request('/api/merchant/settings', json('PATCH', data));
  if (res?.success) invalidateReads('settings');
  return res;
}

// --- Phase 9: Stamp requests (merchant-approved stamps) ---------------------

export interface ScanRequestRow {
  id: string;
  customerPhone: string;
  /** Phase 11: name the customer verified at web sign-in (null on legacy rows). */
  customerName: string | null;
  status: 'PENDING' | 'APPROVED';
  distanceMeters: number | null;
  branchName: string | null;
  createdAt: string;
  decidedAt: string | null;
  offer: { id: string; title: string } | null;
}

export interface ScanRequestListResponse {
  requests: ScanRequestRow[];
  /** Always the open queue size, whichever tab is showing. */
  pendingCount: number;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

/**
 * GET /api/merchant/scan-requests. Defaults to the open queue (`PENDING`);
 * pass `status: 'APPROVED' | 'ALL'` for history.
 */
export async function listScanRequests(params?: {
  status?: 'PENDING' | 'APPROVED' | 'ALL';
  page?: number;
  pageSize?: number;
}) {
  const search = new URLSearchParams();
  if (params?.status) search.set('status', params.status);
  if (params?.page) search.set('page', String(params.page));
  if (params?.pageSize) search.set('pageSize', String(params.pageSize));
  const qs = search.toString();
  return request(`/api/merchant/scan-requests${qs ? `?${qs}` : ''}`);
}

/**
 * POST /api/merchant/scan-requests/[id] — accept a check-in and grant the
 * stamp. Holding is simply not calling this (there is no reject endpoint).
 */
export async function approveScanRequest(id: string) {
  const res = await request(`/api/merchant/scan-requests/${encodeURIComponent(id)}`, {
    method: 'POST',
  });
  if (res?.success) {
    // A granted stamp moves the queue, the badge, and the dashboard totals.
    invalidateReads('scan-requests:PENDING', 'scan-requests:APPROVED', 'scan-requests:pending:count');
  }
  return res;
}

// --- Phase 12: Digital Menu Card ---------------------------------------------

/** One choice inside a modifier group (Phase 12.5): "Small +৳0", "Extra shot +৳40". */
export interface MenuModifierOptionRow {
  id: string;
  name: string;
  /** Display price delta exactly as typed ("+৳60", "Free"); null = no extra. */
  price: string | null;
  /** SINGLE groups may flag a default choice; not meaningful on MULTI. */
  isDefault: boolean;
  sortOrder: number;
}

/** A per-item modifier group: "Size" (SINGLE) or "Extra toppings" (MULTI). */
export interface MenuModifierGroupRow {
  id: string;
  name: string;
  /** SINGLE = pick one (radio); MULTI = pick any (checkbox). */
  selectionType: 'SINGLE' | 'MULTI';
  /** Only meaningful for SINGLE groups; MULTI is always optional. */
  isRequired: boolean;
  sortOrder: number;
  options: MenuModifierOptionRow[];
}

export interface MenuItemRow {
  id: string;
  name: string;
  description: string | null;
  /** Display text exactly as typed — "৳250", "Market price", … */
  price: string | null;
  sortOrder: number;
  isAvailable: boolean;
  /** Add-ons & variants (Phase 12.5) — empty when the item has none. */
  modifierGroups: MenuModifierGroupRow[];
}

export interface MenuCategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  items: MenuItemRow[];
}

/** The merchant's single menu as GET/PUT return it (url/qr only once loaded). */
export interface DigitalMenuRow {
  id: string;
  slug: string;
  title: string;
  backgroundHex: string;
  hasPhoto: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  categories: MenuCategoryRow[];
  /** Absolute `/menu/{slug}` share URL. */
  url?: string;
  /** QR PNG data URL — non-null only while the menu is published. */
  qrDataUrl?: string | null;
}

export interface MenuResponse {
  menu: DigitalMenuRow | null;
  /** Source of the editor's default title before a menu row exists. */
  businessName: string;
}

/** Returned by the photo upload — the row is often created on that call. */
export interface UploadMenuPhotoResponse {
  photoUrl: string;
  menu: DigitalMenuRow;
}

/** Vision output before the merchant edits it: no ids, nothing persisted. */
export interface ExtractMenuResponse {
  draft: MenuDraft;
  photoUrl: string;
}

export async function getDigitalMenu() {
  return request('/api/merchant/menu');
}

/** Replaces the whole menu; `publish: true` is what creates the public URL. */
export async function saveDigitalMenu(data: SaveMenuInput) {
  const res = await request('/api/merchant/menu', json('PUT', data));
  if (res?.success) invalidateReads('menu');
  return res;
}

/** Multipart upload of a camera/gallery image (field name: `photo`). */
export async function uploadMenuPhoto(file: File) {
  const form = new FormData();
  form.append('photo', file);
  return request('/api/merchant/menu/photo', { method: 'POST', body: form });
}

/** Runs OCR on the stored photo and returns an editable draft. */
export async function extractMenuPhoto() {
  return request('/api/merchant/menu/extract', { method: 'POST' });
}

/** Removes the stored photo; the menu itself is untouched. */
export async function removeMenuPhoto() {
  return request('/api/merchant/menu/photo', { method: 'DELETE' });
}
