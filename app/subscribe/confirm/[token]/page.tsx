import type { Metadata } from "next";
import { after } from "next/server";
import { MailLinkPage } from "@/components/mail-link-page";
import { sendEmail, welcomeSubscriberEmail } from "@/lib/server/email";
import { confirmSubscription } from "@/lib/server/subscription";

export const metadata: Metadata = {
  title: "Confirm your subscription",
  // A URL that carries a secret in its path has nothing to gain from being
  // crawled and everything to lose.
  robots: { index: false, follow: false },
};

/**
 * The second half of the double opt-in, and the only place a row becomes real.
 *
 * ## A GET that writes
 *
 * Normally a mistake, and here it is the only option: the link is in an email
 * and a mail client can only follow it one way. It is safe because
 * `confirmSubscription` is idempotent — and because the *unsubscribe* link, the
 * one where a scanner's automatic GET would do real damage, is deliberately not
 * built this way. See `subscriptionUrls`.
 *
 * The welcome mail goes out from here rather than from the query, so the
 * database module keeps no opinion about email, and it goes out in `after()` so
 * the reader is looking at the confirmation before the SMTP round-trip starts.
 */
export default async function ConfirmSubscriptionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // A database blip must not read as "your link is broken" — but there is no
  // honest third message here either, and telling somebody they are subscribed
  // when the write failed is the one lie that matters. `unknown` invites a
  // retry, which is the only useful thing they can do.
  const result = await confirmSubscription(token).catch((err) => {
    console.error("[subscribe/confirm] failed:", err);
    return { outcome: "unknown" } as const;
  });

  if (result.outcome === "confirmed") {
    after(() => sendEmail(welcomeSubscriberEmail(result.email, result.token)));
    return (
      <MailLinkPage title="You're on the list.">
        <p className="mt-2 text-sm text-muted-foreground">
          New components as they ship, no more than one email a week. Every one
          of them carries an unsubscribe link.
        </p>
      </MailLinkPage>
    );
  }

  if (result.outcome === "already") {
    return (
      <MailLinkPage title="You're already on the list.">
        <p className="mt-2 text-sm text-muted-foreground">
          Nothing to do — this link was already used.
        </p>
      </MailLinkPage>
    );
  }

  return (
    <MailLinkPage title="That link isn't valid.">
      <p className="mt-2 text-sm text-muted-foreground">
        It may have been mistyped, or the subscription it belonged to is gone.
        Sign up again from the site and we will send a fresh one.
      </p>
    </MailLinkPage>
  );
}
