'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { FadeUp } from '@/components/animations/FadeUp';
import {
  REWARD_TYPES,
  DEFAULT_STAMP_COUNTS,
  OFFER_TYPES,
  SCRATCH_MODES,
  MAX_SCRATCH_REWARDS,
  MIN_POOL_REWARDS,
  SCRATCH_COOLDOWN_DEFAULT_HOURS,
  SCRATCH_COOLDOWN_MIN_HOURS,
  SCRATCH_COOLDOWN_MAX_HOURS,
  DICE_COUNT_OPTIONS,
  MIN_DICE_COUNT,
  MAX_DICE_COUNT,
  DEFAULT_DICE_COUNT,
} from '@/lib/constants';
import {
  Tag,
  Clock,
  Link2,
  CheckCircle2,
  Check,
  Gift,
  Stamp,
  Dices,
  Plus,
  Trash2,
} from 'lucide-react';
import { discountRange } from '@/lib/dice';

export type OfferType = 'STAMP' | 'SCRATCH' | 'DICE';
export type ScratchMode = 'FIXED' | 'RANDOM_POOL';

/** Submitted values — discriminated by offerType (Phase 3.5 separation). */
export type OfferFormValues =
  | {
      offerType: 'STAMP';
      title: string;
      rewardType: 'DISCOUNT' | 'FREE_ITEM' | 'CUSTOM';
      requiredStamps: number;
      durationDays: number;
      posterTemplateUrl: string;
    }
  | {
      offerType: 'SCRATCH';
      title: string;
      scratchMode: ScratchMode;
      items: string[];
      /** Hours a customer waits after a reveal before scratching again. */
      scratchCooldownHours: number;
      durationDays: number;
      posterTemplateUrl: string;
    }
  | {
      offerType: 'DICE';
      title: string;
      /** How the customer rolls — 1..5 six-sided dice, sum = discount percent. */
      diceCount: number;
      durationDays: number;
      posterTemplateUrl: string;
    };

/** Flat bag of optional initial values (keeps callers free of union wrangling). */
export interface OfferFormInitialValues {
  offerType?: OfferType;
  title?: string;
  rewardType?: 'DISCOUNT' | 'FREE_ITEM' | 'CUSTOM';
  requiredStamps?: number | null;
  scratchMode?: ScratchMode | null;
  items?: string[];
  scratchCooldownHours?: number;
  diceCount?: number | null;
  durationDays?: number;
  posterTemplateUrl?: string;
}

interface OfferFormProps {
  initialValues?: OfferFormInitialValues;
  /** Edit mode: the offer type is fixed after creation. */
  typeLocked?: boolean;
  submitLabel: string;
  submitting?: boolean;
  error?: string;
  successMessage?: string;
  onSubmit: (values: OfferFormValues) => Promise<void>;
}

const DURATION_CHIPS = [30, 60, 90, 180];

/** Preset scratch reveal cooldowns (hours) — anything else goes in the input. */
const COOLDOWN_CHIPS = [1, 6, 12, 24, 48, 72];

const REWARD_PREVIEW_LABEL: Record<string, string> = {
  DISCOUNT: 'Discount reward',
  FREE_ITEM: 'Free item reward',
  CUSTOM: 'Custom gift reward',
};

/**
 * One skin per offer type: selected colour, header icon tile, status chip and
 * the one-line explainer shown under the type picker. Amber stays the
 * scratch/offer accent, so dice gets its own indigo identity instead of
 * borrowing it.
 */
const OFFER_TYPE_SKIN: Record<
  OfferType,
  {
    selectedClass: string;
    tileClass: string;
    markClass: string;
    chipClass: string;
    focusRing: string;
    icon: React.ComponentType<{ className?: string }>;
    hint: string;
  }
> = {
  STAMP: {
    selectedClass: 'border-brand-green bg-primary-fixed/40 text-brand-green',
    tileClass: 'bg-primary-fixed/70 text-brand-green',
    markClass: 'bg-brand-green',
    chipClass: 'bg-primary-fixed text-on-primary-fixed',
    focusRing: 'focus:ring-brand-green',
    icon: Stamp,
    hint: 'Customers collect a stamp with every check-in until the reward unlocks.',
  },
  SCRATCH: {
    selectedClass: 'border-brand-amber bg-amber-50 text-amber-700',
    tileClass: 'bg-amber-100 text-amber-700',
    markClass: 'bg-brand-amber',
    chipClass: 'bg-amber-100 text-amber-800',
    focusRing: 'focus:ring-brand-amber',
    icon: Gift,
    hint: 'Customers scratch a card once to reveal the reward inside.',
  },
  DICE: {
    selectedClass: 'border-indigo-500 bg-indigo-50 text-indigo-700',
    tileClass: 'bg-indigo-100 text-indigo-700',
    markClass: 'bg-indigo-600',
    chipClass: 'bg-indigo-100 text-indigo-800',
    focusRing: 'focus:ring-indigo-500',
    icon: Dices,
    hint: 'Customers roll once — the dice total is their discount percent.',
  },
};

/** Radio state mark — a solid seal when chosen, a hairline ring when not. */
const RadioMark: React.FC<{ selected: boolean; markClass: string }> = ({
  selected,
  markClass,
}) =>
  selected ? (
    <span
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${markClass} text-white`}
      aria-hidden="true"
    >
      <Check className="h-2.5 w-2.5" />
    </span>
  ) : (
    <span
      className="h-4 w-4 shrink-0 rounded-full border border-outline-variant bg-white"
      aria-hidden="true"
    />
  );

export const OfferForm: React.FC<OfferFormProps> = ({
  initialValues,
  typeLocked = false,
  submitLabel,
  submitting = false,
  error = '',
  successMessage = '',
  onSubmit,
}) => {
  const [offerType, setOfferType] = useState<OfferType>(initialValues?.offerType ?? 'STAMP');
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [rewardType, setRewardType] = useState<'DISCOUNT' | 'FREE_ITEM' | 'CUSTOM'>(
    initialValues?.rewardType ?? 'DISCOUNT'
  );
  const [requiredStamps, setRequiredStamps] = useState<number>(
    initialValues?.requiredStamps ?? DEFAULT_STAMP_COUNTS[0]
  );
  const [scratchMode, setScratchMode] = useState<ScratchMode>(
    initialValues?.scratchMode ?? 'FIXED'
  );
  const [items, setItems] = useState<string[]>(
    initialValues?.items && initialValues.items.length > 0
      ? initialValues.items
      : ['']
  );
  const [durationDays, setDurationDays] = useState<number>(initialValues?.durationDays ?? 90);
  const [scratchCooldownHours, setScratchCooldownHours] = useState<number>(
    initialValues?.scratchCooldownHours ?? SCRATCH_COOLDOWN_DEFAULT_HOURS
  );
  const [diceCount, setDiceCount] = useState<number>(
    initialValues?.diceCount ?? DEFAULT_DICE_COUNT
  );
  const [posterTemplateUrl, setPosterTemplateUrl] = useState(
    initialValues?.posterTemplateUrl ?? ''
  );
  const [localError, setLocalError] = useState('');

  const displayedError = localError || error;
  const isScratch = offerType === 'SCRATCH';
  const isDice = offerType === 'DICE';
  const typeSkin = OFFER_TYPE_SKIN[offerType];
  const TypeIcon = typeSkin.icon;
  const typeLabel = OFFER_TYPES.find((ot) => ot.value === offerType)?.label ?? '';

  // --- Scratch reward rows -------------------------------------------------
  const updateItem = (index: number, value: string) =>
    setItems((prev) => prev.map((it, i) => (i === index ? value : it)));

  const addItem = () =>
    setItems((prev) =>
      prev.length >= MAX_SCRATCH_REWARDS ? prev : [...prev, '']
    );

  const removeItem = (index: number) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  const switchMode = (mode: ScratchMode) => {
    setScratchMode(mode);
    // Fixed mode has exactly one row; pool mode seeds a second row.
    setItems((prev) => (mode === 'FIXED' ? prev.slice(0, 1) : prev.length >= 2 ? prev : [prev[0] ?? '', '']));
  };

  const switchType = (type: OfferType) => {
    if (typeLocked) return;
    setOfferType(type);
    setLocalError('');
  };

  // --- Validation (mirrors backend scratchOfferSchema / offerSchema) -------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      setLocalError('Offer title must be at least 3 characters');
      return;
    }
    if (trimmedTitle.length > 80) {
      setLocalError('Offer title must be 80 characters or fewer');
      return;
    }
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
      setLocalError('Duration must be between 1 and 365 days');
      return;
    }
    const poster = posterTemplateUrl.trim();
    if (poster) {
      try {
        new URL(poster);
      } catch {
        setLocalError('Poster template URL must be a valid URL');
        return;
      }
    }

    if (isDice) {
      if (
        !Number.isInteger(diceCount) ||
        diceCount < MIN_DICE_COUNT ||
        diceCount > MAX_DICE_COUNT
      ) {
        setLocalError(`Choose between ${MIN_DICE_COUNT} and ${MAX_DICE_COUNT} dice`);
        return;
      }
      await onSubmit({
        offerType: 'DICE',
        title: trimmedTitle,
        diceCount,
        durationDays,
        posterTemplateUrl: poster,
      });
      return;
    }

    if (!isScratch) {
      if (!Number.isInteger(requiredStamps) || requiredStamps < 2 || requiredStamps > 100) {
        setLocalError('A stamp card needs between 2 and 100 stamps');
        return;
      }
      await onSubmit({
        offerType: 'STAMP',
        title: trimmedTitle,
        rewardType,
        requiredStamps,
        durationDays,
        posterTemplateUrl: poster,
      });
      return;
    }

    const trimmedItems = items.map((it) => it.trim()).filter((it) => it.length > 0);
    if (trimmedItems.length < 1) {
      setLocalError('Add at least one reward');
      return;
    }
    if (trimmedItems.some((it) => it.length > 60)) {
      setLocalError('Reward names must be 60 characters or fewer');
      return;
    }
    if (trimmedItems.length > MAX_SCRATCH_REWARDS) {
      setLocalError(`A scratch card can have at most ${MAX_SCRATCH_REWARDS} rewards`);
      return;
    }
    if (scratchMode === 'FIXED' && trimmedItems.length !== 1) {
      setLocalError('Fixed mode needs exactly one reward');
      return;
    }
    if (scratchMode === 'RANDOM_POOL' && trimmedItems.length < MIN_POOL_REWARDS) {
      setLocalError(`Randomized pool mode needs at least ${MIN_POOL_REWARDS} rewards`);
      return;
    }
    if (
      !Number.isInteger(scratchCooldownHours) ||
      scratchCooldownHours < SCRATCH_COOLDOWN_MIN_HOURS ||
      scratchCooldownHours > SCRATCH_COOLDOWN_MAX_HOURS
    ) {
      setLocalError(
        `Cooldown must be between ${SCRATCH_COOLDOWN_MIN_HOURS} and ${SCRATCH_COOLDOWN_MAX_HOURS} hours`
      );
      return;
    }

    await onSubmit({
      offerType: 'SCRATCH',
      title: trimmedTitle,
      scratchMode,
      items: trimmedItems,
      scratchCooldownHours,
      durationDays,
      posterTemplateUrl: poster,
    });
  };

  // Preview shows at most 15 stamp dots, then a "+N" overflow chip.
  const previewDots = Math.min(requiredStamps, 15);
  const overflow = requiredStamps - previewDots;
  const dicePreview = discountRange(diceCount);
  const trimmedItemsPreview = items.map((it) => it.trim()).filter((it) => it.length > 0);

  return (
    <div className="flex flex-col gap-space-md">
      <FadeUp>
        {/* Form card with tinted micro-header: which offer type is being built */}
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-hairline bg-surface-container-low px-4 py-3.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${typeSkin.tileClass}`}
                aria-hidden="true"
              >
                <TypeIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="font-headline-sm text-headline-sm leading-tight text-on-surface">
                  Offer details
                </h2>
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  Shown live in the customer preview below
                </p>
              </div>
            </div>
            <span
              className={`shrink-0 rounded-pill px-2.5 py-0.5 font-label-sm text-label-sm uppercase ${typeSkin.chipClass}`}
            >
              {typeLabel}
            </span>
          </div>

          <div className="px-4 pb-6 pt-5 sm:px-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-space-lg">
              <Input
                label="Offer Title *"
                placeholder="e.g. Buy 10 Coffees, Get 1 Free"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />

              {/* Offer type — the flows are fully separated from here down */}
              <div className="flex flex-col gap-2">
                <label className="font-label-lg text-label-lg text-on-surface">Offer Type *</label>
                <div
                  className="grid grid-cols-1 gap-space-sm sm:grid-cols-3"
                  role="radiogroup"
                  aria-label="Offer type"
                >
                  {OFFER_TYPES.map((ot) => {
                    const selected = offerType === ot.value;
                    const skin = OFFER_TYPE_SKIN[ot.value as OfferType];
                    const SkinIcon = skin.icon;
                    return (
                      <button
                        key={ot.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={typeLocked}
                        onClick={() => switchType(ot.value as OfferType)}
                        className={`min-h-[44px] rounded-card border p-3.5 text-left transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                          selected
                            ? `${skin.selectedClass} ${skin.focusRing}`
                            : `border-brand-border bg-white text-on-surface-variant hover:bg-surface-container-low ${skin.focusRing}`
                        }`}
                      >
                        <span className="flex items-start justify-between gap-2">
                          <span
                            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                              selected
                                ? skin.tileClass
                                : 'bg-surface-container-high text-on-surface-variant'
                            }`}
                          >
                            <SkinIcon className="h-4 w-4" />
                          </span>
                          <RadioMark selected={selected} markClass={skin.markClass} />
                        </span>
                        <span className="mt-2.5 block font-label-lg text-label-lg">{ot.label}</span>
                      </button>
                    );
                  })}
                </div>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  {typeSkin.hint}
                </span>
                {typeLocked && (
                  <span className="font-body-sm text-body-sm text-on-surface-variant">
                    Type is fixed after creation — edit the fields below instead.
                  </span>
                )}
              </div>

              {isScratch ? (
                <>
                  {/* Scratch mode */}
                  <div className="flex flex-col gap-2">
                    <label className="font-label-lg text-label-lg text-on-surface">
                      Reward Mode *
                    </label>
                    <div
                      className="grid grid-cols-1 gap-space-sm sm:grid-cols-2"
                      role="radiogroup"
                      aria-label="Scratch reward mode"
                    >
                      {SCRATCH_MODES.map((m) => {
                        const selected = scratchMode === m.value;
                        return (
                          <button
                            key={m.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => switchMode(m.value as ScratchMode)}
                            className={`min-h-[44px] rounded-card border p-3.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-amber ${
                              selected
                                ? 'border-brand-amber bg-amber-50 text-amber-700'
                                : 'border-brand-border bg-white text-on-surface-variant hover:bg-surface-container-low'
                            }`}
                          >
                            <span className="flex items-start justify-between gap-2">
                              <span className="font-label-lg text-label-lg">{m.label}</span>
                              <RadioMark selected={selected} markClass="bg-brand-amber" />
                            </span>
                            <span className="mt-1 block font-body-sm text-body-sm">
                              {m.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Reward rows */}
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface">
                      <Gift className="h-4 w-4 text-brand-amber" /> Rewards *{' '}
                      <span className="font-body-sm font-normal text-body-sm text-on-surface-variant">
                        {scratchMode === 'FIXED'
                          ? 'one reward, revealed every time'
                          : 'customers draw from these'}
                      </span>
                    </label>
                    <div className="flex flex-col gap-2">
                      {items.map((value, index) => {
                        const canRemove =
                          scratchMode === 'RANDOM_POOL' && items.length > MIN_POOL_REWARDS;
                        return (
                          <div key={index} className="flex items-center gap-2">
                            <span
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 font-label-sm text-label-sm text-amber-800"
                              aria-hidden="true"
                            >
                              {index + 1}
                            </span>
                            <input
                              type="text"
                              value={value}
                              onChange={(e) => updateItem(index, e.target.value)}
                              placeholder={
                                scratchMode === 'FIXED'
                                  ? 'e.g. Free Dessert'
                                  : `e.g. ${['Free Drink', '20% Off', 'Free Dessert'][index % 3]}`
                              }
                              maxLength={60}
                              className="min-h-[48px] flex-1 rounded-input border border-brand-border bg-white px-3.5 py-2.5 text-body-md text-on-surface transition-all placeholder:text-on-surface-variant/50 focus:border-brand-amber focus:outline-none focus:ring-1 focus:ring-brand-amber"
                              aria-label={`Reward ${index + 1}`}
                            />
                            <button
                              type="button"
                              onClick={() => removeItem(index)}
                              disabled={!canRemove}
                              aria-label={`Remove reward ${index + 1}`}
                              className="grid min-h-[44px] min-w-[44px] place-items-center rounded-input border border-brand-border bg-white text-on-surface-variant transition-colors hover:bg-red-50 hover:text-brand-red focus:outline-none focus:ring-2 focus:ring-brand-red disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-on-surface-variant"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {scratchMode === 'RANDOM_POOL' && (
                      <button
                        type="button"
                        onClick={addItem}
                        disabled={items.length >= MAX_SCRATCH_REWARDS}
                        className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-amber-300 bg-amber-50/60 font-label-lg text-label-lg text-amber-700 transition-colors hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-brand-amber disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-4 w-4" /> Add reward
                        <span className="font-body-sm font-normal text-body-sm">
                          ({items.length}/{MAX_SCRATCH_REWARDS})
                        </span>
                      </button>
                    )}
                    <span className="font-body-sm text-body-sm text-on-surface-variant">
                      {scratchMode === 'FIXED'
                        ? 'The only reward this card can reveal.'
                        : 'Rewards are drawn at random — each one appears regularly as customers scratch.'}
                    </span>
                  </div>

                  {/* Reveal cooldown — how long a customer is locked out after a reveal */}
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface">
                      <Clock className="h-4 w-4 text-brand-amber" /> Reveal Cooldown *
                      <span className="font-body-sm font-normal text-body-sm text-on-surface-variant">
                        hours
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      {COOLDOWN_CHIPS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setScratchCooldownHours(n)}
                          className={`min-h-[44px] min-w-[48px] rounded-pill border px-3 font-label-lg text-label-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brand-amber ${
                            scratchCooldownHours === n
                              ? 'border-brand-amber bg-amber-100 text-amber-800'
                              : 'border-brand-border bg-white text-on-surface-variant hover:bg-surface-container-low'
                          }`}
                          aria-pressed={scratchCooldownHours === n}
                        >
                          {n}h
                        </button>
                      ))}
                      <input
                        type="number"
                        min={SCRATCH_COOLDOWN_MIN_HOURS}
                        max={SCRATCH_COOLDOWN_MAX_HOURS}
                        value={scratchCooldownHours}
                        onChange={(e) => setScratchCooldownHours(Number(e.target.value))}
                        className="min-h-[48px] w-20 rounded-input border border-brand-border bg-white px-3 py-2.5 text-body-md text-on-surface focus:border-brand-amber focus:outline-none focus:ring-1 focus:ring-brand-amber"
                        aria-label="Custom cooldown in hours"
                      />
                    </div>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">
                      A customer must wait this long before scratching this card again. Locks at{' '}
                      {SCRATCH_COOLDOWN_MIN_HOURS}–{SCRATCH_COOLDOWN_MAX_HOURS} hours.
                    </span>
                  </div>
                </>
              ) : isDice ? (
                <>
                  {/* Number of dice — the roll total IS the discount percent */}
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface">
                      <Dices className="h-4 w-4 text-indigo-600" /> Number of Dice *
                      <span className="font-body-sm font-normal text-body-sm text-on-surface-variant">
                        {MIN_DICE_COUNT}–{MAX_DICE_COUNT}
                      </span>
                    </label>
                    <div
                      className="flex flex-wrap items-center gap-2"
                      role="radiogroup"
                      aria-label="Number of dice"
                    >
                      {DICE_COUNT_OPTIONS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={diceCount === n}
                          onClick={() => setDiceCount(n)}
                          className={`min-h-[44px] min-w-[48px] rounded-pill border px-3 font-label-lg text-label-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                            diceCount === n
                              ? 'border-indigo-500 bg-indigo-100 text-indigo-800'
                              : 'border-brand-border bg-white text-on-surface-variant hover:bg-surface-container-low'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">
                      The customer rolls once — the dice total is their discount. {diceCount} dice ={' '}
                      {dicePreview.min}–{dicePreview.max}% off.
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {/* Reward type — green accents, the stamp card's own skin */}
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface">
                      <Tag className="h-4 w-4 text-brand-green" /> Reward Type *
                    </label>
                    <div
                      className="grid grid-cols-1 gap-space-sm sm:grid-cols-3"
                      role="radiogroup"
                      aria-label="Reward type"
                    >
                      {REWARD_TYPES.map((rt) => {
                        const selected = rewardType === rt.value;
                        return (
                          <button
                            key={rt.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() =>
                              setRewardType(rt.value as 'DISCOUNT' | 'FREE_ITEM' | 'CUSTOM')
                            }
                            className={`min-h-[44px] rounded-card border px-3.5 py-2.5 text-left font-label-lg text-label-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green ${
                              selected
                                ? 'border-brand-green bg-primary-fixed/40 text-brand-green'
                                : 'border-brand-border bg-white text-on-surface-variant hover:bg-surface-container-low'
                            }`}
                          >
                            {rt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Required stamps */}
                  <div className="flex flex-col gap-2">
                    <label className="font-label-lg text-label-lg text-on-surface">
                      Required Stamps *
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      {DEFAULT_STAMP_COUNTS.map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRequiredStamps(n)}
                          className={`min-h-[44px] min-w-[48px] rounded-pill border px-3 font-label-lg text-label-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green ${
                            requiredStamps === n
                              ? 'border-brand-green bg-primary-fixed text-on-primary-fixed'
                              : 'border-brand-border bg-white text-on-surface-variant hover:bg-surface-container-low'
                          }`}
                          aria-pressed={requiredStamps === n}
                        >
                          {n}
                        </button>
                      ))}
                      <input
                        type="number"
                        min={2}
                        max={100}
                        value={requiredStamps}
                        onChange={(e) => setRequiredStamps(Number(e.target.value))}
                        className="min-h-[48px] w-20 rounded-input border border-brand-border bg-white px-3 py-2.5 text-body-md text-on-surface focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                        aria-label="Custom stamp count"
                      />
                    </div>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">
                      Customer scans this many times to unlock the reward.
                    </span>
                  </div>
                </>
              )}

              {/* Expiration */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-1.5 font-label-lg text-label-lg text-on-surface">
                  <Clock className="h-4 w-4 text-brand-green" /> Expiration *
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  {DURATION_CHIPS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setDurationDays(n)}
                      className={`min-h-[44px] min-w-[48px] rounded-pill border px-3 font-label-lg text-label-lg transition-colors focus:outline-none focus:ring-2 focus:ring-brand-green ${
                        durationDays === n
                          ? 'border-brand-green bg-primary-fixed text-on-primary-fixed'
                          : 'border-brand-border bg-white text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                      aria-pressed={durationDays === n}
                    >
                      {n}d
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={durationDays}
                    onChange={(e) => setDurationDays(Number(e.target.value))}
                    className="min-h-[48px] w-20 rounded-input border border-brand-border bg-white px-3 py-2.5 text-body-md text-on-surface focus:border-brand-green focus:outline-none focus:ring-1 focus:ring-brand-green"
                    aria-label="Custom duration in days"
                  />
                </div>
                <span className="font-body-sm text-body-sm text-on-surface-variant">
                  Offer expires after this many days.
                </span>
              </div>

              <Input
                label="Poster Template URL (Optional)"
                placeholder="https://example.com/poster.png"
                value={posterTemplateUrl}
                onChange={(e) => setPosterTemplateUrl(e.target.value)}
                helperText="We'll show your QR on top of this poster image"
              />

              {displayedError && (
                <p
                  className="font-body-md text-body-md font-medium text-brand-red"
                  role="alert"
                >
                  {displayedError}
                </p>
              )}
              {successMessage && (
                <p className="flex items-center gap-1.5 font-body-md text-body-md font-medium text-brand-green">
                  <CheckCircle2 className="h-4 w-4" /> {successMessage}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                isLoading={submitting}
                className="w-full min-h-[48px]"
              >
                {submitLabel}
              </Button>
            </form>
          </div>
        </Card>
      </FadeUp>

      {/* Live preview — amber scratch-card aesthetic, indigo for dice */}
      <FadeUp>
        <Card className="p-0 overflow-hidden">
          <div
            className={`flex items-center justify-between gap-3 border-b px-4 py-3.5 sm:px-6 ${
              isDice ? 'border-indigo-200 bg-indigo-50' : 'border-amber-200 bg-amber-50'
            }`}
          >
            <span
              className={`font-label-sm uppercase tracking-wider text-label-sm ${
                isDice ? 'text-indigo-700' : 'text-amber-700'
              }`}
            >
              Customer preview ·{' '}
              {isScratch ? 'Scratch Card' : isDice ? 'Dice Roll' : 'Stamp Card'}
            </span>
            <span
              className={`shrink-0 rounded-pill px-2 py-0.5 font-label-sm text-label-sm ${
                isDice ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              Real-time
            </span>
          </div>

          <div className="flex flex-col gap-3 px-4 pb-5 pt-4 sm:px-6">
            <p className="font-headline-sm text-headline-sm leading-snug text-on-surface">
              {title.trim() || 'Your offer title'}
            </p>

            {isScratch ? (
              <div className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
                {trimmedItemsPreview.length > 0 ? (
                  trimmedItemsPreview.map((it, i) => (
                    <span
                      key={i}
                      className="rounded-pill border border-amber-300 bg-amber-100 px-2.5 py-1 font-label-sm text-label-sm text-amber-800"
                    >
                      {it}
                    </span>
                  ))
                ) : (
                  <span className="rounded-pill border border-dashed border-amber-300 bg-white px-2.5 py-1 font-label-sm text-label-sm text-amber-700">
                    🎁 Mystery reward
                  </span>
                )}
              </div>
            ) : isDice ? (
              <div className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
                {Array.from({ length: diceCount }).map((_, i) => (
                  <span
                    key={i}
                    className="grid h-8 w-8 place-items-center rounded-md border-2 border-indigo-300 bg-white text-body-md font-bold text-indigo-600"
                  >
                    🎲
                  </span>
                ))}
                <span className="rounded-pill border border-indigo-300 bg-indigo-100 px-2.5 py-1 font-label-sm text-label-sm text-indigo-800">
                  {dicePreview.min}–{dicePreview.max}% off
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
                {Array.from({ length: previewDots }).map((_, i) => (
                  <span
                    key={i}
                    className="grid h-6 w-6 place-items-center rounded-full border-2 border-dashed border-amber-400 bg-white font-label-sm text-label-sm text-amber-700"
                  >
                    {i + 1}
                  </span>
                ))}
                {overflow > 0 && (
                  <span className="grid h-6 place-items-center rounded-pill bg-amber-100 px-2 font-label-sm text-label-sm text-amber-800">
                    +{overflow}
                  </span>
                )}
              </div>
            )}

            <div
              className={`flex items-center justify-between gap-2 border-t pt-3 font-body-sm text-body-sm text-on-surface-variant ${
                isDice ? 'border-indigo-200' : 'border-amber-200'
              }`}
            >
              <span className={`font-semibold ${isDice ? 'text-indigo-700' : 'text-amber-700'}`}>
                {isScratch
                  ? scratchMode === 'FIXED'
                    ? 'Fixed reward · scratch to reveal'
                    : `${trimmedItemsPreview.length} rewards · random draw`
                  : isDice
                    ? `${diceCount} dice · total is the discount %`
                    : REWARD_PREVIEW_LABEL[rewardType]}
              </span>
              <span className="tnum">Valid {durationDays} days</span>
            </div>
            <p className="flex items-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant">
              <Link2 className="h-3.5 w-3.5" /> QR poster generated right after you save
            </p>
          </div>
        </Card>
      </FadeUp>
    </div>
  );
};
