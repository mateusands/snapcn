/**
 * Demo mp4s for the pro components, rendered OUTSIDE the app.
 *
 * `render-previews.mts` writes into `public/demos` and updates the manifest the
 * site reads — that is the app. These are for looking at, so they go wherever
 * argv[2] points and touch nothing the site serves.
 */
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";
import { tsconfigWebpackAlias } from "./tsconfig-webpack-alias.mts";

const PRO = [
  "agent-chat", "agent-run", "agent-open", "agent-tools", "app-reveal", "brief-send", "build-out", "chat-thread",
  "focus-pull", "gallery-push", "lcd-type", "manifesto", "phone-pitch",
  "phrase-swarm", "proof-line", "read-through", "render-wall", "say-it", "scatter-bloom", "sentence-set", "showcase-drift",
  "string-hero", "stretch-word", "version-drop", "word-rush", "word-settle",
];
const out = process.argv[2];
const root = process.cwd();
await ensureBrowser();
const tsAliases = tsconfigWebpackAlias(root);
const serveUrl = await bundle({
  entryPoint: path.join(root, "src", "remotion", "dev-entry.ts"),
  ignoreRegisterRootWarning: true,
  webpackOverride: (raw) => {
    const config = enableTailwind(raw);
    const existing = Object.entries(config.resolve?.alias ?? {}).map(([name, alias]) => ({
      name: name.replace(/\$$/, ""), alias: alias as string, onlyModule: name.endsWith("$"),
    }));
    return { ...config, resolve: { ...config.resolve, alias: [...existing, ...tsAliases] } };
  },
});
let i = 0;
for (const id of PRO) {
  i += 1;
  const t = Date.now();
  try {
    const composition = await selectComposition({ serveUrl, id });
    await renderMedia({
      composition, serveUrl, codec: "h264", crf: 20,
      outputLocation: path.join(out, `${id}.mp4`),
    });
    console.log(`[${i}/${PRO.length}] ok   ${id} — ${composition.durationInFrames}f in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(`[${i}/${PRO.length}] FAIL ${id}: ${(e as Error).message.split("\n")[0].slice(0, 80)}`);
  }
}
