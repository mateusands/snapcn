import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { subscribers } from "@/lib/db/schema";
import { clientIp } from "@/lib/server/client-ip";
import { getDb, isDbConfigured } from "@/lib/server/db";
import { confirmSubscriptionEmail, sendEmail } from "@/lib/server/email";
import { checkRateLimit } from "@/lib/server/rate-limit";

const inputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("That email doesn't look right."),
  source: z.string().trim().max(40).optional(),
});

/**
 * How long a confirm mail suppresses the next one for the same address.
 *
 * Not a nicety. Without it, "submit the form" is a public button that makes us
 * send mail to any address the caller names, and the per-IP limiter does not
 * stop a caller with a proxy list from pointing all of it at one stranger. With
 * it, an address can receive at most one confirm mail every five minutes no
 * matter how many machines ask, because the throttle lives on the row rather
 * than on the requester.
 */
const RESEND_CONFIRM_AFTER_MS = 5 * 60 * 1000;

/**
 * Join the launch list — the first half of a double opt-in.
 *
 * ## Nothing is on the list until the address says so
 *
 * A row is written on submit and it is *inert*: `confirmed_at` is null, and the
 * only mail a null row can produce is the confirm link itself. Somebody whose
 * address a stranger typed in gets exactly one message and never hears from us
 * again, which is the whole point — see `confirmSubscriptionEmail`.
 *
 * ## The response never says whether the address was already there
 *
 * Every outcome is `201 {ok:true}`: new, pending, confirmed, unsubscribed. The
 * alternative turns this endpoint into a membership oracle — POST an address,
 * read the status code, learn whether that person is a snapcn user — and the
 * form gains nothing from being honest about it. Re-submitting is a success for
 * the same reason it always was: somebody who signs up twice has told us they
 * want in twice, and an error reads as a rejection.
 *
 * ## Two paths, and both of them are one statement
 *
 * The insert claims new addresses with `onConflictDoNothing`, so an empty
 * `returning()` is how "already had it" is detected without a second query. The
 * update below claims the *re-send* the same way: it is a single conditional
 * UPDATE, so two requests racing on the same address cannot both come back
 * holding a token to mail. Reading the row first and deciding in JavaScript
 * would let them.
 */
export async function POST(req: Request) {
  if (!isDbConfigured) {
    return NextResponse.json(
      { error: "The list isn't configured yet." },
      { status: 503 },
    );
  }

  if (!checkRateLimit(clientIp(req), "subscribe")) {
    return NextResponse.json(
      { error: "Too many signups from here. Try again in a minute." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid email." },
      { status: 400 },
    );
  }

  const { email } = parsed.data;

  try {
    const db = getDb();

    const inserted = await db
      .insert(subscribers)
      .values({ email, source: parsed.data.source ?? "home" })
      .onConflictDoNothing({ target: subscribers.email })
      .returning({ token: subscribers.token });

    const fresh = inserted[0];
    if (fresh) {
      // After the response: the reader should not wait on an SMTP round-trip to
      // find out their address was accepted, and a mail failure must not turn a
      // stored row into an error.
      after(() => sendEmail(confirmSubscriptionEmail(email, fresh.token)));
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    // The address is already known. Re-send the confirm only if it still needs
    // one — never confirmed, or unsubscribed and now asking again — and only if
    // the last one is old enough. `confirm_sent_at` is stamped in the same
    // statement that decides, so the winner of a race is the only sender.
    const claimed = await db
      .update(subscribers)
      .set({ confirmSentAt: new Date() })
      .where(
        and(
          eq(subscribers.email, email),
          or(
            isNull(subscribers.confirmedAt),
            isNotNull(subscribers.unsubscribedAt),
          ),
          lt(
            subscribers.confirmSentAt,
            new Date(Date.now() - RESEND_CONFIRM_AFTER_MS),
          ),
        ),
      )
      .returning({ token: subscribers.token });

    const again = claimed[0];
    if (again) {
      after(() => sendEmail(confirmSubscriptionEmail(email, again.token)));
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("[subscribe] insert failed:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
