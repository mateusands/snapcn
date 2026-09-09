import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Standard Webhooks (Svix) signature verification.
 *
 * Lifted out of `lib/server/dodo.ts` unchanged the day a second sender needed
 * it: Resend signs its delivery webhooks with the same scheme, the same three
 * headers and the same `whsec_` secret shape. Two copies of a verifier is two
 * places to fix a hole in, and the second copy is always the one nobody
 * remembers to fix.
 *
 * **This function is a security boundary for whatever calls it.** For billing
 * it is what grants a paid plan; for email it is what writes to the suppression
 * list, and a forged `email.bounced` for somebody else's address is a denial of
 * service against their sign-in link. Every branch fails closed, including the
 * malformed ones.
 *
 * The scheme, and the three things about it that are easy to get wrong:
 *
 * 1. The signed content is the exact string `${id}.${timestamp}.${rawBody}` —
 *    the *raw* body, byte for byte. Re-serialising the parsed JSON reorders
 *    keys and changes whitespace, and the signature no longer matches.
 * 2. The secret is not the key. `whsec_` is a prefix on a **base64-encoded**
 *    key; the HMAC runs over the decoded bytes. HMAC-ing the printable string
 *    produces a stable, plausible-looking digest that is simply always wrong.
 * 3. `webhook-signature` holds space-separated versioned entries
 *    (`v1,<b64> v1,<b64>`), because a secret rotation means both the old and
 *    new signatures ride along for a while. Any `v1,` entry matching is a
 *    match; checking only the first breaks every rotation.
 *
 * Returns a boolean rather than throwing: a bad signature is an ordinary 401,
 * not an exception path, and a caller that forgot a try/catch would otherwise
 * turn "unsigned request" into a 500 the sender happily retries.
 */

/**
 * How far out of date a signed request may be.
 *
 * Without this the signature alone is a bearer token with no expiry: anyone who
 * captures one valid request body can replay it forever. Five minutes is the
 * Standard Webhooks recommendation — wide enough for clock skew between the
 * sender and us, narrow enough that a captured request is stale before it is
 * useful. Checked in *both* directions, since a far-future timestamp is just as
 * much of a replay window as an old one.
 */
export const TOLERANCE_SECONDS = 300;

export function verifyWebhookSignature(
  rawBody: string,
  headers: Headers,
  secret: string,
): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signature = headers.get("webhook-signature");
  if (!id || !timestamp || !signature || !secret) return false;

  // Compared as a number, but signed as the literal header string — the digest
  // is over the bytes that arrived, not over our re-formatting of them.
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  if (Math.abs(Date.now() / 1000 - sent) > TOLERANCE_SECONDS) return false;

  // `Buffer.from(x, "base64")` is lenient: it drops characters it cannot decode
  // instead of throwing, so a truncated or garbled secret — `whsec_` on its own,
  // a value someone pasted without its body — yields a ZERO-LENGTH key. Node
  // accepts that for HMAC, which means the digest becomes one anybody can
  // compute, and a forged event is accepted. Fail closed on the empty key
  // rather than verifying against a public constant.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();

  for (const entry of signature.split(" ")) {
    // `v1` is the only scheme in use; an unknown version is skipped rather than
    // trusted, so a future `v2` cannot be accepted by a verifier that has no
    // idea how to check it.
    if (!entry.startsWith("v1,")) continue;
    const provided = Buffer.from(entry.slice(3), "base64");
    // `timingSafeEqual` throws on a length mismatch, and a truncated signature
    // is attacker-controlled input, so the length is checked first — the
    // comparison itself stays constant-time.
    if (provided.length !== expected.length) continue;
    if (timingSafeEqual(provided, expected)) return true;
  }

  return false;
}
