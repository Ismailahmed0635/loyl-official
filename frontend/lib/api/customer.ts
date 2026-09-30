import type {
  ScanInput,
  RedeemInput,
  ReviewBonusInput,
  ScratchInput,
  DiceRollInput,
  CustomerSessionInput,
} from '@/backend/validation/schemas';
import type { CardState } from '@/backend/scan';
import type { ScratchState } from '@/backend/scratch';
import type { DiceRollState } from '@/backend/dice';

// --- Types -----------------------------------------------------------------

export type { ScratchState, DiceRollState };

export interface OfferSummary {
  id: string;
  title: string;
  rewardType: 'DISCOUNT' | 'FREE_ITEM' | 'CUSTOM';
  /** Stamp offers only — null on scratch offers. */
  requiredStamps: number | null;
}

/** Phase 9: a check-in awaiting merchant confirmation (never rejected). */
export interface ScanRequestSummary {
  id: string;
  status: 'PENDING' | 'APPROVED';
  createdAt: string;
}

export interface OfferContext {
  authenticated: boolean;
  geoRequired: boolean;
  geoRadiusM: number;
  ended: boolean;
  offer: {
    id: string;
    title: string;
    offerType: 'STAMP' | 'SCRATCH' | 'DICE';
    rewardType: OfferSummary['rewardType'];
    /** Stamp offers only — null on scratch offers. */
    requiredStamps: number | null;
    /** Scratch offers only — null on stamp offers. */
    scratchMode: 'FIXED' | 'RANDOM_POOL' | null;
    /** Scratch offers only: reveal cooldown configured on this card (hours). */
    scratchCooldownHours: number;
    /** Reward-row count for scratch offers (labels stay a surprise). 0 for stamps. */
    itemCount: number;
    /** Dice offers only — how many dice roll (1..5). Null on other types. */
    diceCount: number | null;
    durationDays: number;
    isActive: boolean;
    createdAt: string;
  };
  merchant: {
    id: string;
    businessName: string;
    category: string;
    logoUrl: string | null;
    /** Merchant Settings → social links. Null/empty when never configured. */
    websiteUrl: string | null;
    facebookUrl: string | null;
    instagramUrl: string | null;
  };
  /** Stamp offers only — null on scratch offers. */
  card: CardState | null;
  /** Scratch offers only (when signed in) — null on stamp offers / pre-auth. */
  scratch: ScratchState | null;
  /**
   * Dice offers only (when signed in): the customer's single roll for this
   * offer. `canRoll` is false forever after the first one.
   */
  dice: DiceRollState | null;
  /**
   * Phase 9: the customer's open check-in at this shop, awaiting merchant
   * approval. The stamp is not on the card yet while this is set.
   */
  pendingRequest: ScanRequestSummary | null;
}

export interface ScanResult {
  /** Phase 9: true when the scan opened a request instead of stamping. */
  requested: boolean;
  /** True when this scan matched a check-in that was already waiting. */
  alreadyPending?: boolean;
  card: CardState;
  stamped: number;
  complete: boolean;
  nextScanAt: string | null;
  /** The opened check-in (always present on a successful scan). */
  request: ScanRequestSummary;
  nearestBranch?: { branchName: string; distanceMeters: number } | null;
  reward: {
    title: string;
    rewardType: OfferSummary['rewardType'];
    requiredStamps: number;
    merchantName?: string;
  };
}

export interface RedeemResult {
  card: CardState;
  claimedAt: string;
  reward: {
    title: string;
    rewardType: OfferSummary['rewardType'];
    requiredStamps: number;
    merchantName?: string;
  };
}

export interface ReviewResult {
  card: CardState;
  stamped: number;
  complete: boolean;
  bonus: true;
  reward: Omit<ScanResult['reward'], 'merchantName'>;
}

/** POST /api/customer/scratch success payload (Phase 3.5). */
export interface ScratchRevealResult {
  scratch: ScratchState;
  reward: {
    label: string;
    mode: 'FIXED' | 'RANDOM_POOL';
    title: string;
    merchantName: string;
  };
  scratchedAt: string;
  nextScratchAt: string | null;
  cooldownHours: number;
  nearestBranch?: { branchName: string; distanceMeters: number } | null;
}

/** POST /api/customer/dice success payload — the one-time roll and its discount. */
export interface DiceRollOutcome {
  dice: DiceRollState;
  roll: {
    diceCount: number;
    /** Face value per die, 1..6, in display order. */
    diceValues: number[];
    total: number;
    /** The discount earned — the total, as a percent. */
    discountPercent: number;
  };
  rolledAt: string;
  title: string;
  merchantName: string;
  nearestBranch?: { branchName: string; distanceMeters: number } | null;
}

export interface CustomerCardItem {
  merchantId: string;
  businessName: string;
  category: string;
  logoUrl: string | null;
  offer: OfferSummary | null;
  state: CardState;
}

export interface CardsResponse {
  cards: CustomerCardItem[];
  totals: { cards: number; stampsCollected: number; totalRedeemed: number };
}

// --- Helpers ---------------------------------------------------------------

/** fetch() has no default timeout — bound every wrapper so pages can't hang. */
const API_TIMEOUT_MS = 15_000;

async function request<T = any>(path: string, init?: RequestInit): Promise<T> {
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

// --- Customer APIs (Phase 3) -----------------------------------------------

/**
 * Check-in identity: collects { name, phoneNumber } and mints the customer
 * session. No OTP step — numbers are collected data, not verified identity.
 */
export function createCustomerSession(data: CustomerSessionInput) {
  return request('/api/customer/session', json('POST', data));
}

export async function getOfferContext(offerId: string) {
  // Unwraps the standard envelope: OfferContext on success, or the error
  // envelope ({ success: false, error }) — callers check `res.offer`.
  const res = await request(`/api/customer/offers/${encodeURIComponent(offerId)}`);
  if (res?.success) return res.data;
  return res;
}

export function scanOffer(data: ScanInput) {
  return request('/api/customer/scan', json('POST', data));
}

export function redeemOffer(offerId: string) {
  return request('/api/customer/redeem', json('POST', { offerId } satisfies RedeemInput));
}

/** Reveals the reward behind a Scratch Card offer's foil. */
export function scratchOffer(data: ScratchInput) {
  return request('/api/customer/scratch', json('POST', data));
}

export function reviewBonus(offerId: string) {
  return request('/api/customer/review', json('POST', { offerId } satisfies ReviewBonusInput));
}

/**
 * Rolls the dice once for a DICE offer. A repeat call returns the error
 * envelope with code `ALREADY_ROLLED` and the existing roll in `data.dice`.
 */
export function rollDiceOffer(data: DiceRollInput) {
  return request('/api/customer/dice', json('POST', data));
}

export function listCustomerCards() {
  return request('/api/customer/cards');
}
