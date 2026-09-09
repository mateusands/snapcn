import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import {
  ensureBrowser,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";
import { tsconfigWebpackAlias } from "./tsconfig-webpack-alias.mts";

/**
 * One render of a component, cut into every shape a social channel asks for.
 *
 *   pnpm run cuts --only wordmark-cut
 *   pnpm run cuts --only wordmark-cut,text-swell
 *
 * Writes `out/cuts/<slug>/` — gitignored, nothing here is served by the site:
 *
 *   16x9.mp4   1920x1080   X, YouTube, the site's own og:video
 *   1x1.mp4    1080x1080   feed square
 *   4x5.mp4    1080x1350   LinkedIn, Instagram — the tallest a feed allows
 *   9x16.mp4   1080x1920   Shorts, Reels, TikTok
 *   4x3.mp4    1440x1080   slide decks, Peerlist
 *   clip.gif   640 wide    READMEs and issues, where an mp4 is a dead link
 *                          (steps down for a component GIF cannot compress)
 *   og.png     1200x630    Product Hunt thumbnail, og:image
 *   loop15.mp4 1920x1080   the 16:9 looped past 15s, for feed dwell
 *
 * ## Why one render and not eight
 *
 * Every scene is authored at 1280x720 and most of them `contain`-fit a reference
 * box inside whatever frame they are given, so re-rendering at 1080x1920 does
 * not reflow anything — it produces the same picture with more empty stage, at
 * eight times the render cost, and breaks outright on the scenes that position
 * in reference px. So: render once at `scale: 2` (a 2560x1440 master, sharp
 * because it is a real 2x device-pixel-ratio render and not an upscale), then
 * fit it into each shape. Every output is a downsample of that master.
 *
 * The fill is not black bars: it is the master's own corner pixel, so for the
 * fifty-odd components sitting on a flat `previewBackdrop` there is no bar to
 * see at all and the clip reads as authored for the shape. See `padColor`.
 *
 * Requires ffmpeg on PATH — unlike `render-previews.mts`, where it is an
 * optimisation, here it *is* the feature.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** Target length of `loop15.mp4`, in seconds. */
const LOOP_SECONDS = 15;

/** Device-pixel-ratio of the master render. 2 makes 1920x1080 a downsample. */
const MASTER_SCALE = 2;

const SHAPES = [
  { file: "16x9.mp4", w: 1920, h: 1080 },
  { file: "1x1.mp4", w: 1080, h: 1080 },
  { file: "4x5.mp4", w: 1080, h: 1350 },
  { file: "9x16.mp4", w: 1080, h: 1920 },
  { file: "4x3.mp4", w: 1440, h: 1080 },
] as const;

/**
 * The biggest GIF worth handing anybody. GitHub refuses a README image over
 * 10MB and most chat clients start transcoding well before that, so aim under.
 */
const GIF_BUDGET = 8 * 1024 * 1024;

/**
 * GIF settings, best first, stepped down until one fits `GIF_BUDGET`.
 *
 * There is no single setting that serves this registry. A GIF is 256 colours
 * with no interframe prediction at all, so its size is set by how much of the
 * frame CHANGES, and the two ends of the registry are two orders of magnitude
 * apart: `wordmark-cut` is flat type on flat paper and comes out at 973KB at
 * the top setting, while `orbit-gallery` is thirty photographs orbiting for ten
 * seconds and comes out at 16MB — unpostable. Measured, both.
 *
 * So encode, look at the file, and step down if it is too big. Nearly every
 * component takes the first rung and pays one encode; the photographic handful
 * pay three or four, which is a few seconds. The last rung is taken whether it
 * fits or not — a too-big GIF is better than no GIF, and the mp4s are the real
 * deliverable anyway.
 */
export const GIF_STEPS = [
  { fps: 25, width: 640, seconds: 0 },
  { fps: 20, width: 640, seconds: 0 },
  { fps: 15, width: 640, seconds: 8 },
  { fps: 15, width: 480, seconds: 8 },
  { fps: 12, width: 480, seconds: 6 },
] as const;

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

/**
 * How many EXTRA times to replay a clip to cover `target` seconds.
 *
 * ffmpeg's `-stream_loop` counts repeats, not plays — 0 plays the file once. A
 * clip already at or past the target loops zero times and is used as it is; a
 * clip of unknown or zero length would divide by zero, so it does the same.
 */
export function loopCount(duration: number, target = LOOP_SECONDS): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.ceil(target / duration) - 1);
}

function ffmpeg(args: string[], what: string) {
  const done = spawnSync("ffmpeg", ["-nostdin", "-v", "error", "-y", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (done.status !== 0) throw new Error(`ffmpeg failed: ${what}`);
}

interface Probe {
  w: number;
  h: number;
  duration: number;
}

function probe(file: string): Probe {
  const out = spawnSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  const [dims, duration] = String(out.stdout ?? "")
    .trim()
    .split("\n");
  const [w, h] = (dims ?? "").split(",").map(Number);
  return { w, h, duration: Number(duration) };
}

/** Round down to even — a 4:2:0 chroma plane is half the size and must be whole. */
const even = (n: number) => n - (n % 2);

export interface Fit {
  /** The frame `pad` builds, which is the requested size rounded down to even. */
  dstW: number;
  dstH: number;
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Where a `src` frame lands inside a `dst` one, `contain`-fitted and centred.
 *
 * Every number it returns is even, including the destination — an odd border
 * puts the scene's chroma plane on a half-pixel, which is a colour fringe down
 * the seam the smear below exists to avoid, and an odd frame will not encode as
 * 4:2:0 at all. Every shape here is already even, so the rounding is a guard
 * rather than a behaviour.
 */
export function fit(
  srcW: number,
  srcH: number,
  requestedW: number,
  requestedH: number,
): Fit {
  const dstW = even(requestedW);
  const dstH = even(requestedH);
  const k = Math.min(dstW / srcW, dstH / srcH);
  const w = Math.min(dstW, even(Math.round(srcW * k)));
  const h = Math.min(dstH, even(Math.round(srcH * k)));
  const left = even(Math.floor((dstW - w) / 2));
  const top = even(Math.floor((dstH - h) / 2));
  return {
    dstW,
    dstH,
    w,
    h,
    left,
    top,
    right: dstW - w - left,
    bottom: dstH - h - top,
  };
}

/**
 * The colour to fill the borders with: the master's exact top-left pixel.
 *
 * Exact, not an average of a few — a mean rounds down the moment one neighbour
 * differs, and one level out draws a line straight across the frame. (The crop
 * is 2x2 and not 1x1 only because a 4:2:0 chroma plane half that size is zero
 * pixels wide and ffmpeg refuses it; the first three bytes of the rgb24 result
 * are the corner pixel itself.)
 *
 * ponytail: this leaves a residual step of about one level on a flat backdrop,
 * because a synthetic fill and a resampled region do not quantise identically
 * through one H.264 encode. Fixing it properly means compositing in RGB, which
 * means owning the full-range tagging of every output — a much more visible bug
 * than the seam. Measured at the edge of perceptibility; revisit if it shows.
 *
 * The obvious alternative, `fillborders=mode=smear`, is seamless BY
 * CONSTRUCTION and was tried first. It is wrong: it smears whatever is on the
 * frame edge, and `phone-frame` ends on a phone bleeding off the bottom, so
 * 9:16 came out as a metre of vertical streaks pulled off a photograph. A flat
 * bar is plain. Plain beats broken.
 */
function padColor(master: string): string {
  const out = spawnSync("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-i",
    master,
    "-frames:v",
    "1",
    "-vf",
    "crop=2:2:0:0,format=rgb24",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  ]);
  const rgb = out.stdout;
  if (out.status !== 0 || !rgb || rgb.length < 3) {
    throw new Error("could not sample the fill colour from the master render");
  }
  return `#${rgb.subarray(0, 3).toString("hex")}`;
}

/** Fit the whole frame inside `dstW` x `dstH`, centred, and fill the rest. */
function fitPad(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  color: string,
) {
  const f = fit(srcW, srcH, dstW, dstH);
  const scale = `scale=${f.w}:${f.h}:flags=lanczos`;
  if (!f.left && !f.right && !f.top && !f.bottom) return scale;
  return `${scale},pad=${f.dstW}:${f.dstH}:${f.left}:${f.top}:color=${color}`;
}

/** The encode settings every mp4 here shares. See render-previews.mts. */
const H264 = [
  "-c:v",
  "libx264",
  "-crf",
  "18",
  "-preset",
  "slow",
  // Safari and every mobile browser refuse to decode 4:2:0 progressive H.264
  // without this, and a clip that silently doesn't play is worse than none.
  "-pix_fmt",
  "yuv420p",
  "-an",
  "-movflags",
  "+faststart",
];

/**
 * The GIF, at the best rung of `GIF_STEPS` that fits the budget.
 *
 * No fit-and-pad here — the GIF keeps the master's own shape, because the
 * places that take one (a README, an issue, a Discord) lay it out themselves.
 *
 * Two-pass palette in one graph. Bayer rather than the default error diffusion:
 * on flat type an ordered dither is both quieter to look at AND smaller, since
 * a repeating pattern compresses and diffused noise does not.
 */
function gif(master: string, out: string): (typeof GIF_STEPS)[number] {
  let step: (typeof GIF_STEPS)[number] = GIF_STEPS[0];
  for (const [i, candidate] of GIF_STEPS.entries()) {
    step = candidate;
    ffmpeg(
      [
        ...(step.seconds ? ["-t", String(step.seconds)] : []),
        "-i",
        master,
        "-filter_complex",
        `fps=${step.fps},scale=${step.width}:-2:flags=lanczos,split[a][b];` +
          "[a]palettegen=stats_mode=diff[p];" +
          "[b][p]paletteuse=dither=bayer:bayer_scale=5",
        "-loop",
        "0",
        out,
      ],
      "clip.gif",
    );
    if (statSync(out).size <= GIF_BUDGET || i === GIF_STEPS.length - 1) break;
  }
  return step;
}

function cut(dir: string, master: string, slug: string) {
  const { w: mw, h: mh, duration } = probe(master);
  const color = padColor(master);
  const out = (f: string) => path.join(dir, f);

  for (const { file, w, h } of SHAPES) {
    ffmpeg(
      ["-i", master, "-vf", fitPad(mw, mh, w, h, color), ...H264, out(file)],
      file,
    );
  }

  const gifStep = gif(master, out("clip.gif"));

  // 60% of the way in, not frame 0: most of these scenes animate *in*, so their
  // first frame is an empty stage. Same rule as the demo posters.
  const at = duration > 0 ? (duration * 0.6).toFixed(3) : "0";
  ffmpeg(
    [
      "-ss",
      at,
      "-i",
      master,
      "-frames:v",
      "1",
      "-vf",
      fitPad(mw, mh, 1200, 630, color),
      out("og.png"),
    ],
    "og.png",
  );

  const sixteenNine = out("16x9.mp4");
  const loops = loopCount(duration);
  ffmpeg(
    loops === 0
      ? ["-i", sixteenNine, "-c", "copy", out("loop15.mp4")]
      : [
          "-stream_loop",
          String(loops),
          "-i",
          sixteenNine,
          "-t",
          String(LOOP_SECONDS),
          ...H264,
          out("loop15.mp4"),
        ],
    "loop15.mp4",
  );

  rmSync(master, { force: true });
  console.log(
    `  ${slug} → out/cuts/${slug} (fill ${color}, gif ${gifStep.width}w@${gifStep.fps})`,
  );
}

async function main() {
  const only = getFlag("only");
  if (!only) {
    console.error(
      "usage: pnpm run cuts --only <slug>[,<slug>]\n" +
        "  Deliberately has no all-components mode: 67 components x 8 outputs is\n" +
        "  an hour of encoding, and you post one component at a time.",
    );
    process.exit(1);
  }
  const slugs = only
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (spawnSync("ffmpeg", ["-version"]).status !== 0) {
    console.error("ffmpeg is not on PATH. `brew install ffmpeg`.");
    process.exit(1);
  }

  await ensureBrowser();

  // Webpack doesn't read tsconfig `paths`, and the registry barrels reach into
  // several specific mappings, not just the `@/*` catch-all.
  const tsAliases = tsconfigWebpackAlias(root);

  // The pro tier is a private, gitignored directory, so most checkouts do not
  // have it. Point its barrel at an empty stub when it is missing, and
  // `cuts-root` can import it unconditionally.
  const proBarrel = path.join(root, "registry", "snap-cn-pro", "__index__.tsx");
  const proAlias = {
    name: "@/registry/snap-cn-pro/__index__",
    alias: existsSync(proBarrel)
      ? proBarrel
      : path.join(root, "src", "remotion", "no-pro.ts"),
    onlyModule: true,
  };

  console.log("Bundling cuts entry…");
  const serveUrl = await bundle({
    entryPoint: path.join(root, "src", "remotion", "cuts-entry.ts"),
    // The entry is side-effect-only (CSS, then the root) so `registerRoot` lives
    // one import away, which is the shape every other entry here uses.
    ignoreRegisterRootWarning: true,
    webpackOverride: (raw) => {
      // Without this every Tailwind class in a component is inert in the render
      // (measured: a red box came out white).
      const config = enableTailwind(raw);
      // Remotion's default alias is an object; fold it into the ordered array
      // form (first match wins) so our entries keep their precedence.
      const existing = Object.entries(config.resolve?.alias ?? {}).map(
        ([name, alias]) => ({
          name: name.replace(/\$$/, ""),
          alias: alias as string,
          onlyModule: name.endsWith("$"),
        }),
      );
      return {
        ...config,
        resolve: {
          ...config.resolve,
          alias: [proAlias, ...existing, ...tsAliases],
        },
      };
    },
  });

  const concurrency = Number(process.env.REMOTION_CONCURRENCY) || 4;

  let i = 0;
  for (const slug of slugs) {
    i += 1;
    const tag = `[${i}/${slugs.length}] ${slug}`;

    let composition: Awaited<ReturnType<typeof selectComposition>>;
    try {
      composition = await selectComposition({ serveUrl, id: slug });
    } catch {
      console.error(
        `${tag} — no component "${slug}". It must be a key of registry/__index__ ` +
          "or the pro barrel.",
      );
      process.exitCode = 1;
      continue;
    }

    const dir = path.join(root, "out", "cuts", slug);
    mkdirSync(dir, { recursive: true });
    const master = path.join(dir, "master.mp4");

    await renderMedia({
      serveUrl,
      composition,
      codec: "h264",
      // The master is re-encoded into every output below, so it is an
      // intermediate: keep it near-lossless and let the shapes carry the loss
      // once, not twice.
      crf: 12,
      pixelFormat: "yuv420p",
      audioCodec: null,
      scale: MASTER_SCALE,
      outputLocation: master,
      concurrency,
      onProgress: ({ progress }) => {
        process.stdout.write(
          `\r${tag} render ${(progress * 100).toFixed(0)}%  `,
        );
      },
    });
    process.stdout.write(`\r${tag} cutting…            \n`);

    cut(dir, master, slug);
  }
}

// Guarded so `loopCount` is importable from a test without the import bundling
// the registry and launching a browser. Same shape as motion-check.mts.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
