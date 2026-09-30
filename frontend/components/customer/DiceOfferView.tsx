'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, Transition, useReducedMotion } from 'framer-motion';
import { AlertCircle, Clock, Dices, MapPin, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useConfetti } from '@/components/animations/Confetti';
import { getPosition } from '@/lib/location';
import { diceLanding, diceTumble, popIn } from '@/lib/motion/variants';
import { faceOrientation, landingRotation, normalizeDiceCount } from '@/lib/dice';
import {
  rollDiceOffer,
  DiceRollOutcome,
  DiceRollState,
  OfferContext,
} from '@/lib/api/customer';

interface DiceOfferViewProps {
  ctx: OfferContext;
  offerId: string;
}

/** Pip layout per face on a 3×3 grid (1 = top-left … 9 = bottom-right). */
const PIPS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

/**
 * The six plates of the cube. Each literal class is scanned by Tailwind's JIT
 * (a computed string would not be), and `faceOrientation()` in lib/dice.ts is
 * the exact inverse of each plate's first rotation — so animating the cube to
 * that orientation brings the plate square to the camera. Opposite pairs
 * (1/6, 3/4, 2/5) sum to 7 like a real die.
 */
const DIE_PLATES: Array<{ face: number; cls: string }> = [
  { face: 1, cls: '[transform:translateZ(20px)]' },
  { face: 6, cls: '[transform:rotateY(180deg)_translateZ(20px)]' },
  { face: 3, cls: '[transform:rotateY(90deg)_translateZ(20px)]' },
  { face: 4, cls: '[transform:rotateY(-90deg)_translateZ(20px)]' },
  { face: 2, cls: '[transform:rotateX(-90deg)_translateZ(20px)]' },
  { face: 5, cls: '[transform:rotateX(90deg)_translateZ(20px)]' },
];

/** One die: a cube of six pip plates. `face` null shows "?" on the front. */
const Die: React.FC<{ face: number | null }> = ({ face }) => (
  <span className="relative block w-10 h-10 [transform-style:preserve-3d]">
    {DIE_PLATES.map((plate) => {
      // Pre-roll the front plate is a mystery; every other plate keeps its
      // fixed pip count, so a die mid-tumble already reads as a real die.
      const pips = face === null && plate.face === 1 ? null : PIPS[plate.face];
      return (
        <span
          key={plate.face}
          className={`absolute inset-0 rounded-[10px] bg-surface-container-lowest border-2 border-on-surface/10 shadow-hairline grid grid-cols-3 grid-rows-3 p-1 gap-0.5 [backface-visibility:hidden] ${plate.cls}`}
        >
          {pips ? (
            Array.from({ length: 9 }).map((_, i) => (
              <span
                key={i}
                className={`rounded-full ${
                  pips.includes(i + 1) ? 'bg-on-surface' : 'bg-transparent'
                }`}
              />
            ))
          ) : (
            <span className="col-span-3 row-span-3 grid place-items-center text-sm font-bold text-on-surface-variant/50">
              ?
            </span>
          )}
        </span>
      );
    })}
  </span>
);

/** Resting orientation for a die: the rolled face square to the camera. */
const restOrient = (face: number | null): { rotateX: number; rotateY: number; y: number } =>
  face != null ? { ...faceOrientation(face), y: 0 } : { rotateX: 0, rotateY: 0, y: 0 };

/**
 * One die in its 3D slot: perspective → a slight resting tilt (so the cube
 * reads as an object, not a sticker) → the cube rotated to `orient`.
 * All transform-style links stay `preserve-3d` so the plates live in one
 * rendering context all the way down.
 */
const DieSlot: React.FC<{
  face: number | null;
  orient: ReturnType<typeof restOrient>;
  transition?: Transition;
}> = ({ face, orient, transition }) => (
  <span className="block [perspective:600px]">
    <span className="block [transform:rotateX(8deg)_rotateY(-10deg)] [transform-style:preserve-3d]">
      <motion.span
        className="block [transform-style:preserve-3d]"
        initial={false}
        animate={{ rotateX: orient.rotateX, rotateY: orient.rotateY, y: orient.y }}
        transition={transition}
      >
        <Die face={face} />
      </motion.span>
    </span>
  </span>
);

/**
 * The customer dice flow for DICE offers — fully decoupled from stamp and
 * scratch. One plate, the configured dice on top, and one prominent
 * "Roll the Dice" button underneath.
 *
 * The roll is a real 3D flip: the dice tumble cube-over-cube (stepped every
 * ~130ms so each die spins at its own speed), and when the server answers they
 * spin down onto the exact face each one landed on — never a rewind, always at
 * least one more full turn (`landingRotation`), staggered so they settle one by
 * one. The one-time limit is a lifetime (the server's unique constraint is the
 * authority), so this view renders exactly one of: unavailable notice → roll
 * panel → rolling → the discount that customer already earned.
 */
export const DiceOfferView: React.FC<DiceOfferViewProps> = ({ ctx, offerId }) => {
  const shouldReduceMotion = useReducedMotion();
  const fireConfetti = useConfetti();

  const [dice, setDice] = useState<DiceRollState | null>(ctx.dice);
  const [result, setResult] = useState<DiceRollOutcome | null>(null);
  const [rolling, setRolling] = useState(false);
  // True while the spin-down plays: the result exists but the dice are still
  // flipping to their faces. Without this the component would swap to the
  // already-rolled branch the instant the server answers, unmounting the dice
  // mid-flip and cutting the landing animation short.
  const [landing, setLanding] = useState(false);
  const [error, setError] = useState('');
  // Live cube orientations while tumbling/landing; null = at rest on `faceValues`.
  const [spin, setSpin] = useState<Array<ReturnType<typeof restOrient>> | null>(null);
  const landingTimer = useRef<number | null>(null);
  const clearLandingTimer = useCallback(() => {
    if (landingTimer.current !== null) {
      window.clearTimeout(landingTimer.current);
      landingTimer.current = null;
    }
  }, []);
  useEffect(() => clearLandingTimer, [clearLandingTimer]);

  // Context refreshes (e.g. re-mount after the OTP redirect) re-sync state.
  const ctxDiceRef = useRef(ctx.dice);
  useEffect(() => {
    if (ctx.dice !== ctxDiceRef.current) {
      ctxDiceRef.current = ctx.dice;
      setDice(ctx.dice);
    }
  }, [ctx.dice]);

  const diceCount = normalizeDiceCount(ctx.offer.diceCount);
  const unavailable = !ctx.offer.isActive || ctx.ended;
  const hasRoll = !!dice && !dice.canRoll;
  const faceValues = result?.roll.diceValues ?? dice?.lastRoll?.diceValues ?? null;

  // Mirror of `spin` so the (async) roll handler always lands from the cube's
  // current orientation without re-rendering to read state.
  const spinRef = useRef(spin);
  useEffect(() => {
    spinRef.current = spin;
  }, [spin]);

  // Tumble: step the spin every 130ms — each die advances at its own speed and
  // hops in turn, so five dice never move in lockstep. Skipped under reduced
  // motion (the dice simply wait for the result and land instantly).
  useEffect(() => {
    if (!rolling || shouldReduceMotion) return;
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      setSpin((prev) => {
        const base: Array<ReturnType<typeof restOrient>> =
          prev ?? Array.from({ length: diceCount }, () => restOrient(null));
        return base.map((o, i) => ({
          rotateX: o.rotateX + 360 + i * 60,
          rotateY: o.rotateY + 450 + i * 90,
          y: tick % 2 === 1 ? -(8 + i * 2) : 0,
        }));
      });
    }, 130);
    return () => window.clearInterval(id);
  }, [rolling, shouldReduceMotion, diceCount]);

  const doRoll = useCallback(async () => {
    if (rolling || landing || unavailable || hasRoll) return;

    /** Spin-down to the rolled faces — or flat to `null` (settle without a face). */
    const landOn = (faces: number[] | null) => {
      const base = spinRef.current ?? Array.from({ length: diceCount }, () => restOrient(null));
      setSpin(
        Array.from({ length: diceCount }, (_, i) => {
          const target = restOrient(faces?.[i] ?? null);
          if (shouldReduceMotion) return target;
          return {
            rotateX: landingRotation(base[i].rotateX, target.rotateX),
            rotateY: landingRotation(base[i].rotateY, target.rotateY),
            y: 0,
          };
        })
      );
    };

    /**
     * Hold the roll panel open until the spin-down finishes (diceLanding
     * 0.7s + the per-die stagger, plus a frame of slack), so the dice flip in
     * one continuous slot instead of being unmounted mid-flip by the switch
     * to the already-rolled branch. Reduced motion lands instantly.
     */
    const landWithResult = (faces: number[] | null) => {
      landOn(faces);
      if (shouldReduceMotion) return;
      clearLandingTimer();
      setLanding(true);
      landingTimer.current = window.setTimeout(
        () => {
          landingTimer.current = null;
          setLanding(false);
        },
        700 + Math.max(0, diceCount - 1) * 60 + 160
      );
    };

    setError('');
    setRolling(true);
    try {
      let latitude: number | null = null;
      let longitude: number | null = null;

      if (ctx.geoRequired) {
        try {
          const pos = await getPosition();
          latitude = pos.coords.latitude;
          longitude = pos.coords.longitude;
        } catch {
          setError(
            'This shop verifies your location. Please allow location access and try again.'
          );
          landOn(null);
          return;
        }
      }

      const res = await rollDiceOffer({ offerId, latitude, longitude });
      if (res?.success) {
        const data = res.data as DiceRollOutcome;
        setResult(data);
        setDice(data.dice);
        landWithResult(data.roll.diceValues);
        fireConfetti();
        return;
      }

      const code = res?.error?.code;
      const data = res?.data || {};
      if (code === 'ALREADY_ROLLED') {
        // Someone (or this same phone) already rolled — show what they won.
        const prior = (data.dice as DiceRollState | undefined)?.lastRoll?.diceValues ?? null;
        if (data.dice) setDice(data.dice as DiceRollState);
        landWithResult(prior);
        setError('You have already rolled for this offer — your discount is below.');
      } else if (code === 'NEED_LOCATION') {
        landOn(null);
        setError('This shop verifies your location. Please allow location access.');
      } else if (code === 'LOCATION_OUT_OF_RANGE') {
        landOn(null);
        setError(
          `You are about ${data.distanceMeters ?? '?'} m away — you need to be within ${
            data.radiusM ?? ctx.geoRadiusM
          } m of the shop to roll.`
        );
      } else if (code === 'OFFER_PAUSED' || code === 'OFFER_ENDED') {
        const prior = (data.dice as DiceRollState | undefined)?.lastRoll?.diceValues ?? null;
        if (data.dice) setDice(data.dice as DiceRollState);
        landWithResult(prior);
        setError(res?.error?.message || 'This offer is not available right now.');
      } else if (code === 'WRONG_OFFER_TYPE') {
        landOn(null);
        setError('This offer is not a dice roll.');
      } else {
        landOn(null);
        setError(res?.error?.message || 'Could not roll the dice. Please try again.');
      }
    } catch {
      landOn(null);
      setError('Network error — check your connection and try again.');
    } finally {
      setRolling(false);
    }
  }, [rolling, landing, unavailable, hasRoll, ctx.geoRequired, ctx.geoRadiusM, offerId, fireConfetti, shouldReduceMotion, diceCount, clearLandingTimer]);

  // Cube transition per die: tumble step in flight, staggered bounce landing
  // after, instant under reduced motion.
  const slotTransition = (i: number): Transition =>
    shouldReduceMotion ? { duration: 0 } : rolling ? diceTumble : { ...diceLanding, delay: i * 0.06 };

  // --- Unavailable ----------------------------------------------------------
  if (unavailable && !hasRoll) {
    return (
      <Card className="p-5 flex flex-col gap-4">
        <div className="flex items-start gap-2 rounded-input bg-surface-container-low border border-hairline px-3 py-2.5">
          <Clock className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {ctx.ended
              ? 'This offer has ended — the shop may post a new one soon.'
              : 'This offer is paused by the shop right now.'}
          </p>
        </div>
        <Button variant="outline" className="w-full" disabled>
          Roll unavailable
        </Button>
      </Card>
    );
  }

  // --- Already rolled: the discount this customer earned --------------------
  // Gated on `!landing` so an in-session roll finishes its spin-down in the
  // roll panel first; the swap below is then visually seamless (same pose,
  // same faces). A fresh page load pops the dice in as before.
  if (hasRoll && !landing) {
    const last = dice!.lastRoll!;
    const rolledAt = result?.rolledAt ?? last.rolledAt;
    return (
      <Card className="p-5 flex flex-col gap-4 border-indigo-200 bg-indigo-50/60">
        <div>
          <h1 className="font-headline-sm text-headline-sm text-on-surface leading-snug">
            {ctx.offer.title}
          </h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
            You already rolled — this discount is yours for this visit
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2" aria-hidden="true">
          {(faceValues ?? []).map((face, i) => (
            <motion.div
              key={`${i}-${face}`}
              variants={popIn}
              initial={result || shouldReduceMotion ? false : 'hidden'}
              animate="visible"
            >
              <DieSlot face={face} orient={restOrient(face)} transition={{ duration: 0 }} />
            </motion.div>
          ))}
        </div>

        <div className="rounded-input bg-surface-container-lowest border border-indigo-200 px-4 py-3 text-center">
          <p className="font-metric-num text-metric-num text-indigo-700 tabular-nums">
            {last.discountPercent}% off
          </p>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Dice total <span className="font-semibold text-on-surface">{last.total}</span> · one
            roll per offer
          </p>
        </div>

        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Show this screen at the counter. Rolled{' '}
          {new Date(rolledAt).toLocaleString()} — you can only roll once for this offer.
        </p>
      </Card>
    );
  }

  // --- Roll panel -----------------------------------------------------------
  return (
    <Card className="p-5 flex flex-col gap-4">
      <div>
        <h1 className="font-headline-sm text-headline-sm text-on-surface leading-snug">
          {ctx.offer.title}
        </h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
          Roll {diceCount} {diceCount === 1 ? 'die' : 'dice'} once — the total is your discount
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-input bg-brand-red/5 border border-brand-red/25 px-3 py-2.5">
          <AlertCircle className="w-4 h-4 text-brand-red shrink-0 mt-0.5" />
          <p className="font-body-sm text-body-sm text-brand-red">{error}</p>
        </div>
      )}

      {/* Plate on a table, dice sitting on top of it */}
      <div className="relative mx-auto w-48 h-52" aria-hidden="true">
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-44 h-3 rounded-pill bg-surface-container-high/80" />
        <div className="absolute bottom-0 inset-x-0 mx-auto w-40 h-4 rounded-t-[4px] bg-surface-container" />
        <div className="absolute top-0 inset-x-0 mx-auto w-44 h-44 rounded-full bg-surface-container-lowest border-[6px] border-surface-container-high shadow-hairline" />
        <div className="absolute top-4 inset-x-0 mx-auto w-36 h-36 rounded-full border border-surface-container-low" />
        <div className="absolute top-0 inset-x-0 h-44 grid place-items-center">
          <div className="flex flex-wrap justify-center gap-2 w-40">
            {Array.from({ length: diceCount }).map((_, i) => {
              const face = faceValues?.[i] ?? null;
              return (
                <motion.div
                  key={i}
                  variants={popIn}
                  initial={shouldReduceMotion ? false : 'hidden'}
                  animate="visible"
                >
                  <DieSlot
                    face={face}
                    orient={spin?.[i] ?? restOrient(face)}
                    transition={slotTransition(i)}
                  />
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      {rolling || landing ? (
        <div
          className="min-h-[48px] w-full flex items-center justify-center gap-2 rounded-pill bg-indigo-600 text-white font-label-lg text-label-lg"
          aria-busy="true"
        >
          <Sparkles className="w-4 h-4 animate-pulse" /> Rolling…
        </div>
      ) : (
        <Button
          variant="primary"
          className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 focus:ring-indigo-600"
          onClick={doRoll}
        >
          <Dices className="w-4 h-4 mr-1.5" /> Roll the Dice
        </Button>
      )}

      <p className="font-body-sm text-body-sm text-on-surface-variant text-center">
        One roll per visit — the dice total is the discount you take to the counter.
      </p>

      {ctx.geoRequired && (
        <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center justify-center gap-1 -mt-1">
          <MapPin className="w-3.5 h-3.5" /> Location check: within {ctx.geoRadiusM} m of the shop
        </p>
      )}
    </Card>
  );
};
