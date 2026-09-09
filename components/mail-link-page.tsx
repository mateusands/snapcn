import Link from "next/link";
import type { ReactNode } from "react";
import { SnapCnLogo } from "@/components/snapcn-logo";

/**
 * The frame the two pages an email link can land on share.
 *
 * `/subscribe/confirm/[token]` and `/u/[token]` are the only pages on this site
 * a person reaches from their inbox rather than from the site, and both are one
 * card with one sentence in it. Written once because the alternative is two
 * copies of the same ten lines drifting apart the first time the card's radius
 * changes — same reasoning as `NewsletterForm`, at a smaller scale.
 *
 * Deliberately not the `/signin` chrome refactored: that page has a session, an
 * error map and a provider list, and pulling a layout out of it to serve these
 * two would make the sign-in page depend on the newsletter's.
 */
export function MailLinkPage({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <Link href="/" aria-label="snapcn home" className="mb-8">
        <SnapCnLogo className="h-8" />
      </Link>

      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        {children}
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        <Link href="/docs/components" className="underline underline-offset-4">
          Browse the components
        </Link>
      </p>
    </main>
  );
}
