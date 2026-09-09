import { Composition, registerRoot } from "remotion";
import { RENDERED_DEMOS } from "@/lib/rendered-demos";
import registry from "@/registry/__index__";
import { makeStage } from "./preview-stage";

/**
 * Bundle root for `scripts/render-previews.mts`: one composition per slug in
 * `RENDERED_DEMOS`, rendered to the mp4 that the site plays in place of a live
 * `<Player>`.
 *
 * The stage itself lives in `preview-stage.tsx` — `cuts-root` renders the same
 * scenes on the same surface, and the two must not drift.
 */

// Stable component identity per composition — building these inside render would
// remount the scene every frame.
const STAGES = Object.fromEntries(
  RENDERED_DEMOS.filter((slug) => registry[slug]).map((slug) => [
    slug,
    makeStage(registry[slug]),
  ]),
);

export function PreviewsRoot() {
  return (
    <>
      {Object.entries(STAGES).map(([slug, Stage]) => {
        const { config } = registry[slug];
        return (
          <Composition
            key={slug}
            id={slug}
            component={Stage}
            durationInFrames={config.durationInFrames}
            fps={config.fps}
            width={config.compositionWidth}
            height={config.compositionHeight}
          />
        );
      })}
    </>
  );
}

registerRoot(PreviewsRoot);
