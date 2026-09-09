import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/lib/server/subscription";

/**
 * The one place a subscription is switched off, and the target of the
 * `List-Unsubscribe` header.
 *
 * ## Why POST and not GET
 *
 * RFC 8058 one-click is a POST for one reason, and it is the same reason this
 * endpoint refuses to act on GET: mail clients and corporate security gateways
 * fetch every URL in a message *before* a human reads it. A GET that
 * unsubscribes would quietly empty the list from the inside, and the symptom —
 * "our open rate collapsed" — points nowhere near the cause. GET here only
 * redirects to the page with the button on it.
 *
 * ## No CSRF token, deliberately
 *
 * Gmail cannot send one. The unguessable token in the path *is* the
 * authorisation, the action is idempotent, and the worst a forged request can
 * do is stop mail that the person holding the token was entitled to stop
 * anyway. This is exactly the model RFC 8058 assumes.
 *
 * ## Two callers, two answers
 *
 * Gmail wants a 2xx and reads nothing; a browser form wants to end up somewhere
 * it can see. The `Accept` header separates them, and the redirect carries
 * `?done=1` so the page can say what happened rather than re-offering a button
 * that has already been pressed.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Even an invalid token answers 200 to a machine. A one-click endpoint that
  // returns an error gets the message marked as broken by the sender's own
  // reputation tooling, and there is nothing a retry could fix.
  try {
    await unsubscribeByToken(token);
  } catch (err) {
    // Logged and swallowed: see above. A 500 here is a "this sender is broken"
    // signal, for a request whose outcome the caller cannot act on anyway.
    console.error("[unsubscribe] update failed:", err);
  }

  if (request.headers.get("accept")?.includes("text/html")) {
    return NextResponse.redirect(new URL(`/u/${token}?done=1`, request.url), {
      // 303: the browser must follow with GET. A 307 would re-POST the form to
      // a page, which is a 405.
      status: 303,
    });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

/** A link scanner's GET, or a client that opens the header URL in a browser. */
export function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return params.then(({ token }) =>
    NextResponse.redirect(new URL(`/u/${token}`, request.url), { status: 302 }),
  );
}
