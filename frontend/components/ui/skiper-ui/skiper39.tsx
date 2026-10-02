"use client";

import { gsap } from "gsap";
import React, { useEffect, useRef } from "react";

interface CrowdCanvasProps {
  src: string;
  rows?: number;
  cols?: number;
}

const CrowdCanvas = ({ src, rows = 15, cols = 7 }: CrowdCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const config = {
      src,
      rows,
      cols,
    };

    // UTILS
    const randomRange = (min: number, max: number) =>
      min + Math.random() * (max - min);
    const randomIndex = (array: any[]) => randomRange(0, array.length) | 0;
    const removeFromArray = (array: any[], i: number) => array.splice(i, 1)[0];
    const removeItemFromArray = (array: any[], item: any) =>
      removeFromArray(array, array.indexOf(item));
    const removeRandomFromArray = (array: any[]) =>
      removeFromArray(array, randomIndex(array));
    const getRandomFromArray = (array: any[]) => array[randomIndex(array) | 0];

    // TWEEN FACTORIES
    const resetPeep = ({ stage, peep }: { stage: any; peep: any }) => {
      const direction = Math.random() > 0.5 ? 1 : -1;
      const offsetY = 100 - 250 * gsap.parseEase("power2.in")(Math.random());
      const startY = stage.height - peep.height + offsetY;
      let startX: number;
      let endX: number;

      if (direction === 1) {
        startX = -peep.width;
        endX = stage.width;
        peep.scaleX = 1;
      } else {
        startX = stage.width + peep.width;
        endX = 0;
        peep.scaleX = -1;
      }

      peep.x = startX;
      peep.y = startY;
      peep.anchorY = startY;

      return {
        startX,
        startY,
        endX,
      };
    };

    const normalWalk = ({ peep, props }: { peep: any; props: any }) => {
      const { startX, startY, endX } = props;
      const xDuration = 10;
      const yDuration = 0.25;

      const tl = gsap.timeline();
      tl.timeScale(randomRange(0.5, 1.5));
      tl.to(
        peep,
        {
          duration: xDuration,
          x: endX,
          ease: "none",
        },
        0,
      );
      tl.to(
        peep,
        {
          duration: yDuration,
          repeat: xDuration / yDuration,
          yoyo: true,
          y: startY - 10,
        },
        0,
      );

      return tl;
    };

    const walks = [normalWalk];

    // TYPES
    type Peep = {
      image: CanvasImageSource;
      rect: number[];
      width: number;
      height: number;
      drawArgs: any[];
      x: number;
      y: number;
      anchorY: number;
      scaleX: number;
      walk: any;
      setRect: (rect: number[]) => void;
      render: (ctx: CanvasRenderingContext2D) => void;
    };

    // FACTORY FUNCTIONS
    const createPeep = ({
      image,
      rect,
    }: {
      image: CanvasImageSource;
      rect: number[];
    }): Peep => {
      const peep: Peep = {
        image,
        rect: [],
        width: 0,
        height: 0,
        drawArgs: [],
        x: 0,
        y: 0,
        anchorY: 0,
        scaleX: 1,
        walk: null,
        setRect: (rect: number[]) => {
          peep.rect = rect;
          peep.width = rect[2];
          peep.height = rect[3];
          peep.drawArgs = [peep.image, ...rect, 0, 0, peep.width, peep.height];
        },
        render: (ctx: CanvasRenderingContext2D) => {
          ctx.save();
          ctx.translate(peep.x, peep.y);
          ctx.scale(peep.scaleX, 1);
          ctx.drawImage(
            peep.image,
            peep.rect[0],
            peep.rect[1],
            peep.rect[2],
            peep.rect[3],
            0,
            0,
            peep.width,
            peep.height,
          );
          ctx.restore();
        },
      };

      peep.setRect(rect);
      return peep;
    };

    // MAIN
    // Placeholder draw source; replaced before init() by the worker-decoded
    // ImageBitmap (see the worker block below), or by this same <img> on the
    // main-thread fallback path.
    const img = document.createElement("img");
    let peepSource: CanvasImageSource = img;
    let sourceWidth = 0;
    let sourceHeight = 0;
    const stage = {
      width: 0,
      height: 0,
    };

    const allPeeps: Peep[] = [];
    const availablePeeps: Peep[] = [];
    const crowd: Peep[] = [];
    let initToken = 0;
    let decodeWorker: Worker | null = null;

    const createPeeps = () => {
      const { rows, cols } = config;
      const width = sourceWidth;
      const height = sourceHeight;
      const total = rows * cols;
      const rectWidth = width / rows;
      const rectHeight = height / cols;

      for (let i = 0; i < total; i++) {
        allPeeps.push(
          createPeep({
            image: peepSource,
            rect: [
              (i % rows) * rectWidth,
              ((i / rows) | 0) * rectHeight,
              rectWidth,
              rectHeight,
            ],
          }),
        );
      }
    };

    const initCrowd = () => {
      // Start the walkers in small batches instead of all 105 in one task.
      // Building every gsap timeline up-front was a single 250–340 ms long
      // task under Lighthouse's 4x CPU throttle — the load-time jank a low-end
      // phone actually feels. Batches of 4 stay well under the 50 ms mark.
      const token = ++initToken;
      const step = () => {
        if (token !== initToken) return; // a resize() superseded this queue
        let started = 0;
        while (availablePeeps.length && started < 4) {
          addPeepToCrowd().walk.progress(Math.random());
          started += 1;
        }
        if (availablePeeps.length) requestAnimationFrame(step);
      };
      // Deferred one frame: running the first batch synchronously merged it
      // into resize()'s canvas-allocation task (measured as a 176 ms long
      // task under Lighthouse's 4x throttle).
      requestAnimationFrame(step);
    };

    const addPeepToCrowd = () => {
      const peep = removeRandomFromArray(availablePeeps);
      const walk = getRandomFromArray(walks)({
        peep,
        props: resetPeep({
          peep,
          stage,
        }),
      }).eventCallback("onComplete", () => {
        removePeepFromCrowd(peep);
        addPeepToCrowd();
      });

      peep.walk = walk;

      crowd.push(peep);
      crowd.sort((a, b) => a.anchorY - b.anchorY);

      return peep;
    };

    const removePeepFromCrowd = (peep: Peep) => {
      removeItemFromArray(crowd, peep);
      availablePeeps.push(peep);
    };

    // Backing-store ratio: the wrapper CSS-transforms the canvas down to ~40%
    // of its layout size, so a ratio of 1 is already ~2.5x oversampled at
    // display resolution. Capping at 1 cuts the canvas buffer from ~9 MB
    // (phone dpr 1.75-3) to ~3 MB — the alloc and per-frame clear both scale
    // with it — with zero visible loss for a decorative band.
    const backingDpr = () => Math.min(window.devicePixelRatio || 1, 1);

    let lastFrameTime = 0;

    const render = (time: number) => {
      // Cap the canvas redraw at ~30 fps. The walk tweens still advance at real
      // speed (gsap time is wall-clock, unaffected by this gate) — only the
      // raster work is halved. Lighthouse measured single frames of 70–270 ms
      // from this loop under 4x CPU throttle (105 sprites redrawn every rAF on
      // a large canvas), which is exactly what janks low-end phones in reality.
      if (time - lastFrameTime < 0.033) return;
      lastFrameTime = time;
      if (!canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(backingDpr(), backingDpr());

      crowd.forEach((peep) => {
        peep.render(ctx);
      });

      ctx.restore();
    };

    const resize = () => {
      if (!canvas) return;
      stage.width = canvas.clientWidth;
      stage.height = canvas.clientHeight;
      canvas.width = stage.width * backingDpr();
      canvas.height = stage.height * backingDpr();

      crowd.forEach((peep) => {
        peep.walk.kill();
      });

      crowd.length = 0;
      availablePeeps.length = 0;
      availablePeeps.push(...allPeeps);

      initCrowd();
    };

    const init = () => {
      createPeeps();
      // Split setup across frames: peep records are cheap, but merging the
      // first raster into this task measured a 176 ms long task (>50 ms =
      // blocking) under Lighthouse's 4x CPU throttle. Each remaining piece
      // then runs in its own task.
      requestAnimationFrame(() => {
        if (!canvas.isConnected) return; // unmounted before this frame
        resize();
        gsap.ticker.add(render);
      });
    };

    const setSource = (
      source: CanvasImageSource,
      width: number,
      height: number,
    ) => {
      peepSource = source;
      sourceWidth = width;
      sourceHeight = height;
      init();
    };

    // Last-resort path (no Worker support, or the worker failed): load through
    // <img> and decode on this thread. Modern browsers never take it.
    const decodeOnMainThread = () => {
      img.onload = () => {
        if (typeof createImageBitmap === "function") {
          createImageBitmap(img).then(
            (bitmap) => setSource(bitmap, bitmap.width, bitmap.height),
            () => setSource(img, img.naturalWidth, img.naturalHeight),
          );
        } else {
          setSource(img, img.naturalWidth, img.naturalHeight);
        }
      };
      img.src = config.src;
    };

    // Fetch + decode the 3600x2268 sprite in a Web Worker (production). The
    // decode alone measured ~185 ms of MAIN-thread time at Lighthouse's 4x
    // CPU throttle — the single largest long task at load (createImageBitmap
    // on an <img> still lands on the UI thread in Chrome). The worker returns
    // a zero-copy ImageBitmap via transfer. It is a real same-origin chunk
    // because production CSP has no `blob:` allowance (next.config.mjs).
    // `next dev`'s webpack runtime 404s worker chunks (next 14.2.35, observed
    // 2026-10-02), so dev takes the main-thread path — perf doesn't matter
    // there, and the certified path is the production one.
    if (process.env.NODE_ENV === "production") {
      try {
        const worker = new Worker(
          new URL("./skiper39.decode.worker.ts", import.meta.url),
        );
        decodeWorker = worker;
        worker.onmessage = (
          e: MessageEvent<{ ok: boolean; bitmap?: ImageBitmap }>,
        ) => {
          worker.terminate();
          decodeWorker = null;
          if (e.data.ok && e.data.bitmap) {
            setSource(e.data.bitmap, e.data.bitmap.width, e.data.bitmap.height);
          } else {
            decodeOnMainThread();
          }
        };
        worker.onerror = () => {
          worker.terminate();
          decodeWorker = null;
          decodeOnMainThread();
        };
        worker.postMessage({ src: config.src });
      } catch {
        decodeOnMainThread();
      }
    } else {
      decodeOnMainThread();
    }

    const handleResize = () => resize();
    window.addEventListener("resize", handleResize);

    return () => {
      initToken += 1; // abort any queued walker batches
      decodeWorker?.terminate();
      decodeWorker = null;
      window.removeEventListener("resize", handleResize);
      gsap.ticker.remove(render);
      crowd.forEach((peep) => {
        if (peep.walk) peep.walk.kill();
      });
      if (typeof ImageBitmap !== "undefined" && peepSource instanceof ImageBitmap) {
        peepSource.close();
      }
    };
  }, []);
  return (
    <canvas ref={canvasRef} className="absolute bottom-0 h-[90vh] w-full" />
  );
};

const Skiper39 = () => {
  return (
    <div className="relative h-full w-full bg-white text-black">
      <div className="top-22 absolute left-1/2 grid -translate-x-1/2 content-start justify-items-center gap-6 text-center text-black">
        <span className="relative max-w-[12ch] text-xs uppercase leading-tight opacity-40 after:absolute after:left-1/2 after:top-full after:h-16 after:w-px after:bg-gradient-to-b after:from-white after:to-black after:content-['']">
          Croud Canvas
        </span>
      </div>
      <div className="absolute bottom-0 h-full w-screen">
        <CrowdCanvas src="/images/peeps/all-peeps.png" rows={15} cols={7} />
      </div>
    </div>
  );
};

export { CrowdCanvas, Skiper39 };

/**
 * Skiper 39 Canvas_Landing_004 — React + Canvas
 * Inspired by and adapted from https://codepen.io/zadvorsky/pen/xxwbBQV
 * illustration by https://www.openpeeps.com/
 * We respect the original creators. This is an inspired rebuild with our own taste and does not claim any ownership.
 * These animations aren’t associated with the codepen.io . They’re independent recreations meant to study interaction design
 *
 * License & Usage:
 * - Free to use and modify in both personal and commercial projects.
 * - Attribution to Skiper UI is required when using the free version.
 * - No attribution required with Skiper UI Pro.
 *
 * Feedback and contributions are welcome.
 *
 * Author: @gurvinder-singh02
 * Website: https://gxuri.me
 * Twitter: https://x.com/Gur__vi
 */
