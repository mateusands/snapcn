import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { subscribers } from "@/lib/db/schema";
import { getDb, isDbConfigured } from "@/lib/server/db";
import { type ResendEvent, suppressionFor } from "@/lib/server/resend-events";
import { verifyWebhookSignature } from "@/lib/server/standard-webhooks";
import { suppress } from "@/lib/server/suppression";

// Node runtime: the signature check is an HMAC through `node:crypto` and a
// `timingSafeEqual`, neither of which exists on the Edge runtime.
export const runtime = "nodejs";

/**
 * POST /api/webhooks/resend — the only thing that writes the suppression list.
 *
 * Delivery is the one part of sending mail that happens entirely outside this
 * codebase. Without this endpoint a hard-bounced address stays on the list and
 * is mailed on every campaign forever, and a spam complaint is invisible — both
 * of which are scored against the domain the sign-in links go out on, and
 * neither of which shows up anywhere an operator would look.
 *
 * ## It is signed, and the signature matters more than it looks
 *
 * A forged `email.bounced` naming somebody else's address is a denial of
 * service against that person's account: they are added to the suppression list
 * and their sign-in link is never sent again. So this uses the same Standard
 * Webhooks verifier as billing, and refuses to run at all without a secret —
 * see the note in `app/api/webhooks/dodo/route.ts` for why "no secret means
 * accept" is a two-year fuse.
 *
 * ## Status codes are retry instructions
 *
 * Resend re-sends anything that is not 2xx. An event this app has no use for —
 * `email.delivered`, `email.opened`, a transient bounce — is a **200**: no
 * number of redeliveries will make it interesting. A database failure is a
 * **500**, because that one genuinely should be tried again.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Email webhooks aren't configured yet." },
      { status: 503 },
    );
  }

  // The signature covers these exact bytes. Read the text once, verify it,
  // parse it after — re-stringifying a parsed body changes whitespace and
  // escaping in ways that are invisible in the object and fatal to an HMAC.
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers, secret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = (JSON.parse(raw) ?? {}) as ResendEvent;
  } catch {
    // Signed but unparseable is a broken sender, not a transient failure.
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const hit = suppressionFor(event);
  if (!hit) return NextResponse.json({ ok: true }, { status: 200 });

  if (!isDbConfigured) {
    // Nowhere to write it. 500 so the event comes back once the database is
    // configured, rather than being dropped on the floor during a migration.
    return NextResponse.json({ error: "No database." }, { status: 500 });
  }

  try {
    await suppress(hit.email, hit.reason, hit.detail);

    // A complaint is also a preference, and the two live in different places: a
    // suppressed address may not be mailed, and an unsubscribed row may not be
    // *added back* by a later signup without confirming again. Somebody who
    // pressed "Report spam" has said both things at once.
    if (hit.reason === "complained") {
      await getDb()
        .update(subscribers)
        .set({ unsubscribedAt: new Date() })
        .where(
          and(
            eq(subscribers.email, hit.email),
            isNull(subscribers.unsubscribedAt),
          ),
        );
    }
  } catch (err) {
    console.error("[resend webhook] write failed:", err);
    return NextResponse.json({ error: "Write failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
