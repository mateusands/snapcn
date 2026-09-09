import { loadFont } from "@remotion/google-fonts/Geist";
import { AbsoluteFill, Img } from "remotion";
import { getDefaults } from "@/lib/customizer-config";
import type { RegistryEntry } from "@/registry/__index__";

/**
 * The stage a registry component is rendered on, outside the browser.
 *
 * Shared by `previews-root` (the mp4s the site plays in place of a `<Player>`)
 * and `cuts-root` (the social exports). It exists as its own module because
 * both roots need it and importing a root would run its `registerRoot` — a
 * bundle registers exactly one.
 *
 * The whole point is that the file is *indistinguishable from what the Player
 * would have shown*, minus the stutter. So this reproduces `PreviewStage`
 * exactly, and any drift between the two shows up on the site as a demo that
 * does not match its own component:
 *
 *  - **Props** — `getDefaults(config.controls)`, the same values `PreviewStage`
 *    starts from. Note the registry barrel has already folded in
 *    `SHARED_CONTROLS` and the `MIN_SPEED_ONE` overrides by the time we read the
 *    config, so the defaults here are the real ones, not the ones written in the
 *    config file. (Pro configs do not go through that barrel and so have no
 *    `speed` control; every scene declares `speed = 1` as a parameter default,
 *    which is the same value.)
 *  - **Backdrop** — the same full-bleed `previewBackdrop` fill `PreviewStage`
 *    paints behind the scene, because the preview surface is part of what the
 *    reader is judging.
 *  - **Font** — the site gets Geist from `next/font` as `--font-geist-sans`. A
 *    standalone Remotion bundle has no `next/font`, so load the real face and
 *    publish the same CSS variable the scenes reference. Without this the mp4
 *    silently falls back to Times, which is exactly the kind of difference that
 *    makes a demo worthless.
 *  - **Timing / size** — left to the caller, straight from the config, so the
 *    file's duration is one clean cycle. The `<video loop>` on the site handles
 *    repetition; baking a loop into the file would only make it bigger.
 */
const { fontFamily: GEIST } = loadFont();

export function makeStage(entry: RegistryEntry) {
  const { Component, config } = entry;
  const props = getDefaults(config.controls);

  return function RenderedDemoStage() {
    const scene = <Component {...props} />;
    const backdrop = config.previewBackdrop;
    return (
      <AbsoluteFill
        style={{
          ["--font-geist-sans" as string]: GEIST,
          fontFamily: GEIST,
        }}
      >
        {backdrop &&
          (backdrop.type === "image" ? (
            <AbsoluteFill>
              <Img
                src={backdrop.src}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: backdrop.fit ?? "cover",
                }}
              />
            </AbsoluteFill>
          ) : (
            <AbsoluteFill style={{ background: backdrop.value }} />
          ))}
        {scene}
      </AbsoluteFill>
    );
  };
}
