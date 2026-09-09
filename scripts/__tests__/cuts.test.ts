import { describe, expect, it } from "vitest";
import { GIF_STEPS, fit, loopCount } from "../cuts.mts";

/**
 * `loopCount` feeds ffmpeg's `-stream_loop`, which counts REPEATS, not plays —
 * off by one here and `loop15.mp4` comes out a whole clip short of the 15s it
 * is named for, which is the length that buys autoplay dwell in a feed.
 */
describe("loopCount", () => {
  it("counts repeats, not plays", () => {
    // 15s of a 5s clip is three plays: the original and two repeats.
    expect(loopCount(5)).toBe(2);
    // A clip that divides exactly must not gain a spare repeat.
    expect(loopCount(15)).toBe(0);
    expect(loopCount(7.5)).toBe(1);
    // The real case: registry scenes are ~2s.
    expect(loopCount(2.2)).toBe(6);
  });

  it("never asks ffmpeg to truncate a clip that is already long enough", () => {
    expect(loopCount(20)).toBe(0);
    expect(loopCount(15.001)).toBe(0);
  });

  it("returns 0 rather than Infinity when ffprobe gives nothing back", () => {
    expect(loopCount(0)).toBe(0);
    expect(loopCount(Number.NaN)).toBe(0);
    expect(loopCount(-1)).toBe(0);
  });
});

/**
 * `fit` is handed straight to ffmpeg as `scale`, `pad` and `fillborders`
 * offsets, and every one of them has to be even: a 4:2:0 chroma plane is half
 * the size, so an odd border puts the scene's colour on a half-pixel and prints
 * a fringe down the seam. It also has to add up — a border one pixel out and
 * `fillborders` smears a row of scene instead of replacing a row of pad.
 */
describe("fit", () => {
  const MASTER = [2560, 1440] as const;

  it("covers the shapes the script actually emits", () => {
    // 16:9 into 16:9 — no border at all, so fitSmear drops the filters.
    expect(fit(...MASTER, 1920, 1080)).toEqual({
      dstW: 1920,
      dstH: 1080,
      w: 1920,
      h: 1080,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
    // 16:9 into 9:16 — the extreme case, 1312 rows of fill.
    expect(fit(...MASTER, 1080, 1920)).toEqual({
      dstW: 1080,
      dstH: 1920,
      w: 1080,
      h: 608,
      left: 0,
      right: 0,
      top: 656,
      bottom: 656,
    });
    // og.png is WIDER than 16:9, so this one pads on the left and right.
    expect(fit(...MASTER, 1200, 630)).toEqual({
      dstW: 1200,
      dstH: 630,
      w: 1120,
      h: 630,
      left: 40,
      right: 40,
      top: 0,
      bottom: 0,
    });
  });

  it("is even on every axis and every side, and adds up", () => {
    const shapes = [
      [1920, 1080],
      [1080, 1080],
      [1080, 1350],
      [1080, 1920],
      [1440, 1080],
      [1200, 630],
      // Sizes no shape uses today, to catch a rounding case the five above miss.
      [1001, 1001],
      [640, 361],
      [2560, 1440],
      [100, 3000],
    ] as const;
    for (const [dw, dh] of shapes) {
      const f = fit(...MASTER, dw, dh);
      for (const [name, n] of Object.entries(f)) {
        expect(n % 2, `${dw}x${dh} ${name}=${n} is odd`).toBe(0);
        expect(n, `${dw}x${dh} ${name}`).toBeGreaterThanOrEqual(0);
      }
      expect(f.left + f.w + f.right, `${dw}x${dh} width`).toBe(f.dstW);
      expect(f.top + f.h + f.bottom, `${dw}x${dh} height`).toBe(f.dstH);
    }
  });

  it("never scales the scene up past the frame it is fitted into", () => {
    const f = fit(...MASTER, 400, 400);
    expect(f.w).toBeLessThanOrEqual(400);
    expect(f.h).toBeLessThanOrEqual(400);
  });
});

/**
 * The GIF ladder is walked top to bottom and the FIRST rung under budget wins,
 * so a rung that is not smaller than the one above it can never be reached —
 * and reordering them by hand is exactly how that happens.
 */
describe("GIF_STEPS", () => {
  it("only ever gets smaller", () => {
    // `seconds: 0` means "the whole clip"; price it as the longest scene in the
    // registry so an uncapped rung is comparable to a capped one.
    const LONGEST = 10;
    const cost = (s: (typeof GIF_STEPS)[number]) =>
      s.fps * s.width * (s.seconds || LONGEST);
    for (let i = 1; i < GIF_STEPS.length; i += 1) {
      expect(
        cost(GIF_STEPS[i]),
        `rung ${i} (${JSON.stringify(GIF_STEPS[i])}) is not smaller than the one above`,
      ).toBeLessThan(cost(GIF_STEPS[i - 1]));
    }
  });
});
