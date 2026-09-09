/**
 * Unit tests for app/api/subscribe/route.ts
 *
 * Run with:  pnpm vitest run app/api/subscribe/__tests__
 *
 * The endpoint is a public text box that makes this server send mail to an
 * address the caller chose, so most of what is tested here is what it refuses
 * to do: mail an address twice, mail one that is already confirmed, mail one
 * faster than the throttle allows, or tell the caller whether somebody is on
 * the list.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Chain, called, drizzleChain } from "@/test/stubs/drizzle-chain";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  configured: true,
  allowed: true,
  chain: null as Chain | null,
  sent: [] as unknown[],
}));

vi.mock("@/lib/server/db", () => ({
  get isDbConfigured() {
    return h.configured;
  },
  getDb: () => h.chain?.db,
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkRateLimit: () => h.allowed,
}));

vi.mock("@/lib/server/email", () => ({
  sendEmail: async (email: unknown) => {
    h.sent.push(email);
    return true;
  },
  confirmSubscriptionEmail: (to: string, token: string) => ({
    kind: "confirm",
    to,
    token,
  }),
}));

// `after()` outside a request context is not something this runner can provide,
// and the callback is the whole assertion — run it inline.
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => void fn() };
});

import { POST } from "@/app/api/subscribe/route";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://snapcn.dev/api/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const TOKEN = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

beforeEach(() => {
  h.configured = true;
  h.allowed = true;
  h.sent = [];
  h.chain = drizzleChain([]);
});

describe("guards", () => {
  it("answers 503 with no database, and sends nothing", async () => {
    h.configured = false;
    const res = await POST(post({ email: "ada@example.com" }));
    expect(res.status).toBe(503);
    expect(h.sent).toHaveLength(0);
  });

  it("answers 429 when the bucket is empty, before reading the body", async () => {
    // Ahead of the parse on purpose: the cheapest possible answer to a flood.
    h.allowed = false;
    const res = await POST(post({ email: "ada@example.com" }));
    expect(res.status).toBe(429);
    expect(h.chain?.calls).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });

  it("answers 400 for a body that is not JSON", async () => {
    expect((await POST(post("{"))).status).toBe(400);
  });

  it("answers 400 for anything that is not an email", async () => {
    for (const email of ["", "ada", "ada@", "@example.com", 42, null]) {
      const res = await POST(post({ email }));
      expect(res.status, String(email)).toBe(400);
    }
    expect(h.sent).toHaveLength(0);
  });

  it("answers 500 when the database throws, and says nothing more", async () => {
    h.chain = drizzleChain(Promise.reject(new Error("down")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({ email: "ada@example.com" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Something went wrong. Please try again.",
    });
  });
});

describe("a new address", () => {
  it("is stored and sent exactly one confirm mail", async () => {
    h.chain = drizzleChain([{ token: TOKEN }]);
    const res = await POST(post({ email: "ada@example.com", source: "docs" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.chain.calls[0]?.name).toBe("insert");
    expect(h.chain.calls[1]).toMatchObject({
      name: "values",
      args: [{ email: "ada@example.com", source: "docs" }],
    });
    // `onConflictDoNothing` + `returning` is how "already had it" is detected
    // without a second query.
    expect(called(h.chain, "onConflictDoNothing")).toBe(true);
    expect(h.sent).toEqual([
      { kind: "confirm", to: "ada@example.com", token: TOKEN },
    ]);
  });

  it("normalises the address before it becomes a unique key", async () => {
    h.chain = drizzleChain([{ token: TOKEN }]);
    await POST(post({ email: "  Ada@Example.COM  " }));
    expect(h.chain.calls[1]?.args[0]).toMatchObject({
      email: "ada@example.com",
    });
  });

  it("defaults the source rather than storing nothing", async () => {
    h.chain = drizzleChain([{ token: TOKEN }]);
    await POST(post({ email: "ada@example.com" }));
    expect(h.chain.calls[1]?.args[0]).toMatchObject({ source: "home" });
  });

  it("is NOT sent a welcome mail — that waits for the confirm link", async () => {
    h.chain = drizzleChain([{ token: TOKEN }]);
    await POST(post({ email: "ada@example.com" }));
    expect(h.sent).toHaveLength(1);
    expect((h.sent[0] as { kind: string }).kind).toBe("confirm");
  });
});

describe("an address that is already there", () => {
  it("gets a fresh confirm mail when the claim succeeds", async () => {
    // Insert conflicts (empty array), then the conditional UPDATE returns the
    // row — meaning this request won the throttle and owes them a mail.
    h.chain = drizzleChain([], [{ token: TOKEN }]);
    const res = await POST(post({ email: "ada@example.com" }));

    expect(res.status).toBe(201);
    expect(h.chain.calls.some((c) => c.name === "update")).toBe(true);
    expect(h.sent).toEqual([
      { kind: "confirm", to: "ada@example.com", token: TOKEN },
    ]);
  });

  it("gets NOTHING when the claim matches no row", async () => {
    // Confirmed already, or another request sent one less than five minutes
    // ago. Either way this one must not put a second message in their inbox.
    h.chain = drizzleChain([], []);
    const res = await POST(post({ email: "ada@example.com" }));

    expect(res.status).toBe(201);
    expect(h.sent).toHaveLength(0);
  });

  it("stamps confirm_sent_at in the same statement that decides", async () => {
    // A read-then-decide would let two concurrent requests both come back
    // holding a token to mail.
    h.chain = drizzleChain([], [{ token: TOKEN }]);
    await POST(post({ email: "ada@example.com" }));
    const set = h.chain.calls.find((c) => c.name === "set")?.args[0] as {
      confirmSentAt: Date;
    };
    expect(set.confirmSentAt).toBeInstanceOf(Date);
  });
});

describe("the response", () => {
  it("is identical whether or not the address was already known", async () => {
    // Otherwise the form is a membership oracle: POST an address, read the
    // status code, learn whether that person is a snapcn user.
    const bodies: unknown[] = [];
    for (const results of [
      [[{ token: TOKEN }]], // new
      [[], [{ token: TOKEN }]], // known, re-sent
      [[], []], // known, nothing to do
    ]) {
      h.sent = [];
      h.chain = drizzleChain(...results);
      const res = await POST(post({ email: "ada@example.com" }));
      expect(res.status).toBe(201);
      bodies.push(await res.json());
    }
    expect(bodies).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  });
});
