import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the three ways the registry can drift out of sync with itself.
 *
 * All three had actually happened by the time this was written, and none of them
 * broke a build, a type, or an existing test — which is precisely why they need
 * a test of their own:
 *
 *  1. **Orphans.** `shadcn build` writes `public/r/*.json` but never deletes, so
 *     trimming the registry in ee250e3 left 68 built components whose source was
 *     gone. They still installed — the JSON carries inline file content — which
 *     meant `shadcn add` shipped unmaintained code into a user's project, and
 *     every fetch of one landed in the install count as a real conversion.
 *
 *  2. **Unbuilt components.** `hero-launch` had source and a docs page but no
 *     manifest entry, so `/r/hero-launch.json` 404'd. The docs page rendered an
 *     install command that could not work.
 *
 *  3. **Documented but uninstallable.** The general form of (2): any component
 *     with a docs page that a reader cannot actually install.
 *
 * The registry is generated output committed to the repo, so nothing else in the
 * toolchain compares the three lists. This does.
 */

const ROOT = process.cwd();

const readManifest = (p: string): string[] =>
  (
    JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")) as {
      items: { name: string }[];
    }
  ).items.map((i) => i.name);

const liveComponents = new Set([
  ...readManifest("registry/snap-cn/registry.json"),
  ...readManifest("registry/snap-cn-ui/registry.json"),
]);

const builtComponents = new Set(
  fs
    .readdirSync(path.join(ROOT, "public/r"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    // The whole-registry manifest the CLI resolves before any component; it has
    // no manifest entry of its own by design.
    .filter((n) => n !== "registry"),
);

describe("registry integrity", () => {
  it("builds every component in the manifests", () => {
    const unbuilt = [...liveComponents].filter((n) => !builtComponents.has(n));
    expect(
      unbuilt,
      "in a manifest but missing from public/r — will 404",
    ).toEqual([]);
  });

  it("has no built component missing from the manifests", () => {
    const orphans = [...builtComponents].filter((n) => !liveComponents.has(n));
    expect(
      orphans,
      "in public/r with no manifest entry — installs unmaintained source and inflates the install count",
    ).toEqual([]);
  });

  it("can install everything it documents", () => {
    const docsDir = path.join(ROOT, "content/docs");
    const documented = fs
      .readdirSync(docsDir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".mdx"))
      .map((e) => e.name.slice(0, -".mdx".length))
      // Only pages that name a real component directory — the rest are guides.
      .filter((name) =>
        fs.existsSync(path.join(ROOT, "registry/snap-cn", name)),
      );

    const uninstallable = documented.filter((n) => !liveComponents.has(n));
    expect(
      uninstallable,
      "has a docs page but no manifest entry — its install command cannot work",
    ).toEqual([]);
  });

  /**
   * 4. **A pro row in the public index with no `meta.access`.**
   *
   * The fourth way, and the one that cost the most. `PRO_NAMES` is derived from
   * that marker, `ALL_COMPONENT_NAMES` from `PRO_NAMES`, and the middleware
   * answers an unknown name with a 404 *before* the route that would answer
   * 402. So an unmarked pro row is not a cosmetic defect: the component is
   * advertised in the catalogue and then denied by the server, and `shadcn add`
   * prints "`@snapcn/manifesto` does not exist" at somebody who was trying to
   * buy it.
   *
   * Nine of the fourteen listed pro rows were in exactly that state, and they
   * were the nine most requested names on the site — 105 people in 7 days.
   * Nothing failed: not the build, not a type, not a test. Hence this one.
   *
   * Skipped where the pro tier is not checked out, which is every public clone.
   */
  it("marks every listed pro component as pro", () => {
    const manifest = path.join(ROOT, "registry/snap-cn-pro/registry.json");
    if (!fs.existsSync(manifest)) return;

    const proNames = new Set(
      readManifest("registry/snap-cn-pro/registry.json"),
    );
    const index = JSON.parse(
      fs.readFileSync(path.join(ROOT, "public/r/registry.json"), "utf8"),
    ) as { items: { name: string; meta?: { access?: string } }[] };

    const unmarked = index.items
      .filter((i) => proNames.has(i.name) && i.meta?.access !== "pro")
      .map((i) => i.name);

    expect(
      unmarked,
      'listed in public/r/registry.json but not marked `meta.access: "pro"` — the middleware will 404 these before the 402 route runs',
    ).toEqual([]);
  });
});
