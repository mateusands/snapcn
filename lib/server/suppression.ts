import "server-only";
import { eq } from "drizzle-orm";
import { emailSuppressions } from "@/lib/db/schema";
import { getDb, isDbConfigured } from "@/lib/server/db";

/**
 * The list of addresses no mail may go to, and the two questions asked of it.
 *
 * Kept out of `lib/server/email.ts` so that file stays what it is — a fetch and
 * five templates, testable with no database at all. This module is the only
 * thing in the mail path that touches Postgres.
 *
 * ## Why every send checks, transactional included
 *
 * A mailbox that answered "no such user" will answer it again, and the metric
 * Gmail actually punishes is the *rate* at which a sender aims at addresses
 * that do not exist. It does not care that this particular message was a
 * sign-in link. One dead address retried on every login attempt is a steady
 * drip of bounces against a domain whose reputation the paying customers share.
 *
 * ## Why it fails open
 *
 * `isSuppressed` returns false when the database is unreachable. The other
 * choice — block the send — turns a database blip into "nobody can sign in",
 * which is a worse outage than a handful of avoidable bounces, and it does it
 * silently. Logged, so the blip is visible.
 */

/** Ours, not the provider's — see `suppressionFor` in the webhook. */
export type SuppressionReason = "bounced" | "complained";

/** One shape for the key, so a lookup can never miss on casing alone. */
function key(email: string): string {
  return email.trim().toLowerCase();
}

export async function isSuppressed(email: string): Promise<boolean> {
  if (!isDbConfigured) return false;
  try {
    const rows = await getDb()
      .select({ email: emailSuppressions.email })
      .from(emailSuppressions)
      .where(eq(emailSuppressions.email, key(email)))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    console.error("[suppression] lookup failed, allowing the send:", err);
    return false;
  }
}

/**
 * Record an address as unmailable. Idempotent, and the first reason wins:
 * a bounce followed by a complaint changes nothing that any caller reads.
 */
export async function suppress(
  email: string,
  reason: SuppressionReason,
  detail?: string,
): Promise<void> {
  if (!isDbConfigured) return;
  await getDb()
    .insert(emailSuppressions)
    .values({ email: key(email), reason, detail: detail ?? null })
    .onConflictDoNothing({ target: emailSuppressions.email });
}
