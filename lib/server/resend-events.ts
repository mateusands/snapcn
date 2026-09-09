import "server-only";
import type { SuppressionReason } from "@/lib/server/suppression";

/**
 * Reading a Resend webhook, as one pure function.
 *
 * Split out of the route so the decision it makes — "does this event mean never
 * mail this address again?" — is testable without a signature, a database or a
 * request. It is the only interesting thing the route does, and it is the thing
 * that can lock a real user out of their sign-in link if it is wrong.
 */

/** Only the shape we read. Resend sends much more; none of it is trusted. */
export interface ResendEvent {
  type?: unknown;
  data?: {
    to?: unknown;
    subject?: unknown;
    bounce?: { type?: unknown; subType?: unknown; message?: unknown };
  };
}

export interface Suppression {
  email: string;
  reason: SuppressionReason;
  detail: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The single recipient of an event, or null.
 *
 * Null on a multi-recipient message on purpose. A bounce says one mailbox
 * refused delivery and does not say which, so attributing it to the first
 * address in the list is a coin flip that, when it loses, permanently blocks a
 * real person from receiving a sign-in link. Every send in this codebase is
 * single-recipient (`Email.to` is one string), so a list here means either
 * Resend changed or somebody sent mail another way — both worth a log and
 * neither worth a guess.
 */
function soleRecipient(to: unknown): string | null {
  if (typeof to === "string") return str(to);
  if (Array.isArray(to) && to.length === 1) return str(to[0]);
  return null;
}

/**
 * What, if anything, this event should suppress.
 *
 * Two rules, and the asymmetry between them is the whole design:
 *
 * - **A complaint always suppresses.** Somebody pressed "Report spam". There is
 *   no reading of that which ends in "send them more".
 * - **A bounce suppresses only when it is `Permanent`.** A transient bounce is a
 *   full mailbox, a greylist, a server having a bad afternoon — all of which
 *   clear on their own. Suppressing on one is a user who can never sign in
 *   again, silently, with no way for them to tell us. An unrecognised bounce
 *   shape is treated the same way as a transient one for the same reason: the
 *   cost of guessing wrong in that direction is unbounded and invisible, and
 *   the cost of guessing wrong in the other is a few more bounces on an address
 *   that will bounce again and be caught the next time.
 */
export function suppressionFor(event: ResendEvent): Suppression | null {
  const type = str(event.type);
  const email = soleRecipient(event.data?.to);
  if (!type || !email) return null;

  if (type === "email.complained") {
    return { email, reason: "complained", detail: "spam complaint" };
  }

  if (type === "email.bounced") {
    const kind = str(event.data?.bounce?.type)?.toLowerCase();
    if (kind !== "permanent") return null;
    const sub = str(event.data?.bounce?.subType) ?? "unknown";
    return { email, reason: "bounced", detail: `permanent/${sub}` };
  }

  return null;
}
