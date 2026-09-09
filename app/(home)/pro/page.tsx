import type { Metadata } from "next";
import { NewsletterForm } from "@/components/newsletter-form";
import { PRO_ITEMS } from "@/config/site";
import { FadeUp } from "../components/fade-up";

/**
 * `/pro` — the one page a `shadcn add` of a paid component can be sent to.
 *
 * ## Why it exists
 *
 * The pro catalogue is listed in `public/r/registry.json`, so `shadcn add
 * @snapcn/manifesto` resolves a real name and then cannot install it. Measured
 * over the seven days after the names went visible: 40-60 people did exactly
 * that, ~7 a day, and every one of them was answered with a bare failure. They
 * are the most committed people the funnel ever sees — they had already chosen
 * a component and typed the command — and they were being thrown away.
 *
 * Checkout does not exist until 17 Sep. This page is what stands in until then:
 * it says what the component is, when it arrives, and takes an address. Nothing
 * is priced here and nothing can be bought, deliberately — the launch is one
 * day and this is not it.
 *
 * ## Why the URL is `/pro` and not `/waitlist`
 *
 * Because it does not become wrong. The registry's 402 body prints this URL
 * into somebody's terminal, and a terminal is not a page that can be updated:
 * that string is loose in the world the moment it is printed. `/pro` is the
 * right address for the pro tier before it ships and after, so on 17 Sep this
 * page grows prices and a checkout button rather than being replaced by one —
 * and every URL already printed still lands somewhere true.
 *
 * ## Attribution
 *
 * `NewsletterForm` reads `?ref=` off the URL and prefers it to `defaultSource`,
 * and the terminal link carries `?ref=cli`. So an address won from a failed
 * install is distinguishable from one somebody scrolled to — which is the only
 * way to know whether this page paid for itself.
 */

const LAUNCH = "17 September";

export const metadata: Metadata = {
  title: "Pro components",
  description: `${PRO_ITEMS.length} pro Remotion components, and an agent that assembles a whole video. Arriving ${LAUNCH}.`,
  alternates: { canonical: "/pro" },
  // Not indexable while it is a holding page: it would compete with
  // /docs/components for the component names it lists, and win nothing.
  robots: { index: false, follow: true },
};

export default function ProPage() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="section">
        <FadeUp>
          <p className="text-center font-mono text-sm text-muted-foreground">
            Arriving {LAUNCH}
          </p>
        </FadeUp>

        <FadeUp delay={0.06}>
          <h1 className="mx-auto mt-4 max-w-[18ch] text-pretty text-center font-sans text-[clamp(2.25rem,4.6vw,3.5rem)] font-normal leading-[1.06] tracking-[-0.03em] text-foreground">
            You found a Pro component
          </h1>
        </FadeUp>

        <FadeUp delay={0.1}>
          <p className="mx-auto mt-4 max-w-[52ch] text-pretty text-center text-muted-foreground">
            It is real, it is finished, and it is not installable yet — the
            catalogue went live before the checkout did. Leave an address and
            you will hear the hour it opens, before anyone else does.
          </p>
        </FadeUp>

        <FadeUp delay={0.14}>
          <NewsletterForm
            defaultSource="pro"
            id="pro-email"
            buttonLabel="Notify me"
            className="mx-auto mt-8 max-w-md [&_p]:text-center"
          />
        </FadeUp>

        <FadeUp delay={0.2}>
          <h2 className="mt-20 text-center text-sm font-medium tracking-[-0.01em] text-foreground">
            What is waiting
          </h2>
          <ul className="mx-auto mt-6 grid max-w-4xl gap-3 sm:grid-cols-2">
            {PRO_ITEMS.map((item) => (
              <li
                key={item.name}
                className="rounded-lg border bg-card p-4 text-left"
              >
                <p className="font-medium text-foreground">{item.title}</p>
                <code className="mt-1 block font-mono text-xs text-muted-foreground">
                  @snapcn/{item.name}
                </code>
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                  {item.description}
                </p>
              </li>
            ))}
          </ul>
        </FadeUp>

        <FadeUp delay={0.26}>
          <p className="mx-auto mt-10 max-w-[52ch] text-pretty text-center text-sm text-muted-foreground">
            Everything else on snapcn stays free and MIT, and always will.
          </p>
        </FadeUp>
      </div>
    </section>
  );
}
