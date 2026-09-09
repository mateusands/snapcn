import type { Metadata } from "next";
import { MailLinkPage } from "@/components/mail-link-page";
import { Button } from "@/components/ui/button";
import { addressForToken } from "@/lib/server/subscription";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

/**
 * The human half of unsubscribing. **This page changes nothing.**
 *
 * That is the entire design. Gmail, Outlook and every corporate link scanner
 * fetch each URL in a message before a person sees it, so a GET that
 * unsubscribes will unsubscribe readers who never clicked. So the link in the
 * footer opens this, which only draws a button, and the button POSTs to
 * `/api/unsubscribe/[token]`, which is where the write lives — the same
 * endpoint Gmail's one-click header posts to.
 *
 * A plain `<form method="post">`, no client component: it has to work in a
 * browser with JavaScript off, because the reader is here to leave and being
 * unable to is exactly the frustration that ends in "Report spam".
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const [{ token }, { done }] = await Promise.all([params, searchParams]);

  if (done) {
    return (
      <MailLinkPage title="You're unsubscribed.">
        <p className="mt-2 text-sm text-muted-foreground">
          No more component emails. Signing up again on the site will send a
          fresh confirmation link if you change your mind.
        </p>
      </MailLinkPage>
    );
  }

  const email = await addressForToken(token).catch((err) => {
    console.error("[unsubscribe] lookup failed:", err);
    return null;
  });
  if (!email) {
    return (
      <MailLinkPage title="That link isn't valid.">
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been mistyped, or the subscription it belonged to is
          already gone — either way, you are not on the list.
        </p>
      </MailLinkPage>
    );
  }

  return (
    <MailLinkPage title="Unsubscribe?">
      <p className="mt-2 text-sm text-muted-foreground">
        This stops the component emails to{" "}
        <span className="text-foreground">{email}</span>.
      </p>
      <form method="post" action={`/api/unsubscribe/${token}`} className="mt-5">
        <Button type="submit" variant="destructive" className="w-full">
          Unsubscribe
        </Button>
      </form>
    </MailLinkPage>
  );
}
