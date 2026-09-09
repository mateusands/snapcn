// Bundler entry for the social-cut script (scripts/cuts.mts). Importing the
// root runs `registerRoot(CutsRoot)`. Kept separate from the other entries
// because a bundle registers exactly one root. Side-effect-only by design.
//
// Tailwind + the design-system tokens, compiled into the bundle: a Remotion
// render has no app CSS, so a class like `bg-card` resolves on the site and to
// *nothing* in an mp4 without this line.
import "../../app/globals.css";
import "./cuts-root";
