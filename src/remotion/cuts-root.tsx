import { Composition, registerRoot } from "remotion";
import registry from "@/registry/__index__";
// Resolved to `no-pro.ts` when the pro tier is not checked out — see the note in
// `no-pro.ts`. `scripts/cuts.mts` supplies the alias.
import proRegistry from "@/registry/snap-cn-pro/__index__";
import { makeStage } from "./preview-stage";

/**
 * Bundle root for `scripts/cuts.mts`: EVERY component, free and pro, on the same
 * stage the site's rendered demos use.
 *
 * Separate from `previews-root` only because of the cast list. That root is
 * `RENDERED_DEMOS`, and it has to stay that way — `render-previews.mts` renders
 * whatever the root registers into `public/demos` and hashes the lot into a
 * manifest the site serves. A cut is for X and LinkedIn, is not committed, and
 * is wanted for components that have no rendered demo and never will.
 *
 * The stage is shared, so a cut looks like the demo looks like the Player.
 */
const allComponents = { ...registry, ...proRegistry };

// Stable component identity per composition — building these inside render would
// remount the scene every frame.
const STAGES = Object.fromEntries(
  Object.entries(allComponents).map(([slug, entry]) => [
    slug,
    makeStage(entry),
  ]),
);

export function CutsRoot() {
  return (
    <>
      {Object.entries(STAGES).map(([slug, Stage]) => {
        const { config } = allComponents[slug];
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

registerRoot(CutsRoot);
