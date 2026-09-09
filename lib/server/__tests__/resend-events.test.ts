/**
 * Unit tests for lib/server/resend-events.ts
 *
 * Run with:  pnpm vitest run lib/server/__tests__/resend-events.test.ts
 *
 * This function decides who never receives mail from us again, so the failure
 * it has to be tested against is not "a bounce slipped through" — it is a real
 * user, silently unable to receive a sign-in link, with no way to tell us and
 * nothing on screen that would explain it. Every case below is written from
 * that direction.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { suppressionFor } from "@/lib/server/resend-events";

const bounced = (type: unknown, to: unknown = ["ada@example.com"]) => ({
  type: "email.bounced",
  data: { to, bounce: { type, subType: "General", message: "no such user" } },
});

describe("suppressionFor", () => {
  it("suppresses a spam complaint, always", () => {
    // Somebody pressed "Report spam". There is no reading of that which ends in
    // sending them more.
    expect(
      suppressionFor({
        type: "email.complained",
        data: { to: ["ada@example.com"] },
      }),
    ).toEqual({
      email: "ada@example.com",
      reason: "complained",
      detail: "spam complaint",
    });
  });

  it("suppresses a permanent bounce, and records what kind", () => {
    expect(suppressionFor(bounced("Permanent"))).toEqual({
      email: "ada@example.com",
      reason: "bounced",
      detail: "permanent/General",
    });
    // Case is the provider's business, not ours.
    expect(suppressionFor(bounced("permanent"))?.reason).toBe("bounced");
    expect(suppressionFor(bounced("PERMANENT"))?.reason).toBe("bounced");
  });

  it("does NOT suppress a transient bounce", () => {
    // A full mailbox, a greylist, a server having a bad afternoon. All of them
    // clear on their own; suppressing on one is a permanent lockout for a
    // temporary condition.
    expect(suppressionFor(bounced("Transient"))).toBeNull();
    expect(suppressionFor(bounced("Undetermined"))).toBeNull();
  });

  it("does NOT suppress a bounce whose type it cannot read", () => {
    // The asymmetry is deliberate: guessing "permanent" on an unfamiliar shape
    // costs a user their account access, and guessing "transient" costs one
    // more bounce on an address that will bounce again and be caught next time.
    for (const shape of [
      { type: "email.bounced", data: { to: ["ada@example.com"] } },
      { type: "email.bounced", data: { to: ["ada@example.com"], bounce: {} } },
      bounced(undefined),
      bounced(null),
      bounced(42),
      bounced(""),
      bounced("   "),
    ]) {
      expect(suppressionFor(shape), JSON.stringify(shape)).toBeNull();
    }
  });

  it("refuses to guess which of several recipients bounced", () => {
    // Every send in this codebase is single-recipient, so a list here means
    // something changed. Attributing the bounce to the first address is a coin
    // flip that locks out a real person when it loses.
    expect(
      suppressionFor({
        ...bounced("Permanent"),
        data: {
          to: ["ada@example.com", "bob@example.com"],
          bounce: { type: "Permanent" },
        },
      }),
    ).toBeNull();
    expect(suppressionFor(bounced("Permanent", []))).toBeNull();
  });

  it("accepts a bare string recipient as well as a one-element list", () => {
    expect(suppressionFor(bounced("Permanent", "ada@example.com"))?.email).toBe(
      "ada@example.com",
    );
  });

  it("ignores every event it has no use for", () => {
    for (const type of [
      "email.sent",
      "email.delivered",
      "email.opened",
      "email.clicked",
      "email.delivery_delayed",
      "contact.created",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(
        suppressionFor({ type, data: { to: ["ada@example.com"] } }),
        String(type),
      ).toBeNull();
    }
  });

  it("survives a body with nothing in it", () => {
    // The route hands over whatever `JSON.parse` produced. It is signed, which
    // proves who sent it and nothing at all about its shape.
    for (const body of [
      {},
      { data: {} },
      { type: "email.bounced" },
      { type: "email.complained" },
      { type: "email.complained", data: { to: null } },
      { type: "email.complained", data: { to: [null] } },
      { type: "email.complained", data: { to: [""] } },
    ]) {
      expect(() => suppressionFor(body), JSON.stringify(body)).not.toThrow();
      expect(suppressionFor(body), JSON.stringify(body)).toBeNull();
    }
  });

  it("trims the address it returns, because it becomes a primary key", () => {
    expect(
      suppressionFor({
        type: "email.complained",
        data: { to: ["  ada@example.com  "] },
      })?.email,
    ).toBe("ada@example.com");
  });
});
