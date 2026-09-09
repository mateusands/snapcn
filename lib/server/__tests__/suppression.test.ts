/**
 * Unit tests for lib/server/suppression.ts
 *
 * Run with:  pnpm vitest run lib/server/__tests__/suppression.test.ts
 *
 * Two behaviours matter here and neither is the happy path: that an
 * unconfigured deployment never touches a database, and that a *broken* one
 * lets mail through rather than blocking it. The second is the one that turns a
 * database blip into "nobody can sign in" if it is written the other way round.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Chain, drizzleChain } from "@/test/stubs/drizzle-chain";

vi.mock("server-only", () => ({}));

let configured = true;
let chain: Chain;
let getDbImpl: () => unknown;

vi.mock("@/lib/server/db", () => ({
  get isDbConfigured() {
    return configured;
  },
  getDb: () => getDbImpl(),
}));

import { isSuppressed, suppress } from "@/lib/server/suppression";

beforeEach(() => {
  configured = true;
  chain = drizzleChain([]);
  getDbImpl = () => chain.db;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isSuppressed", () => {
  it("is false, and silent, with no database configured", async () => {
    configured = false;
    getDbImpl = () => {
      throw new Error("getDb must not be called");
    };
    expect(await isSuppressed("ada@example.com")).toBe(false);
  });

  it("is true when the address has a row", async () => {
    chain = drizzleChain([{ email: "ada@example.com" }]);
    expect(await isSuppressed("ada@example.com")).toBe(true);
    expect(chain.calls[0]?.name).toBe("select");
    // One row is all the question needs; the address is the primary key.
    expect(chain.calls.at(-1)).toEqual({ name: "limit", args: [1] });
  });

  it("is false when it does not", async () => {
    expect(await isSuppressed("ada@example.com")).toBe(false);
  });

  it("matches on a normalised address, so casing cannot miss", async () => {
    // The webhook reports whatever the remote server said; the form lowercases.
    // A lookup that respected the difference would let a suppressed address
    // back in by capitalising it.
    chain = drizzleChain([{ email: "ada@example.com" }]);
    expect(await isSuppressed("  Ada@Example.COM ")).toBe(true);
  });

  it("FAILS OPEN when the database is down", async () => {
    // Deliberate. Blocking the send instead would turn one bad minute in
    // Postgres into a sign-in outage, silently, for everybody.
    getDbImpl = () => {
      throw new Error("ECONNREFUSED");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await isSuppressed("ada@example.com")).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it("fails open on a rejected query too, not just a thrown getDb", async () => {
    chain = drizzleChain(Promise.reject(new Error("timeout")));
    getDbImpl = () => chain.db;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await isSuppressed("ada@example.com")).toBe(false);
  });
});

describe("suppress", () => {
  it("does nothing with no database configured", async () => {
    configured = false;
    getDbImpl = () => {
      throw new Error("getDb must not be called");
    };
    await expect(
      suppress("ada@example.com", "bounced"),
    ).resolves.toBeUndefined();
  });

  it("inserts the normalised address with its reason", async () => {
    await suppress("  Ada@Example.COM ", "complained", "spam complaint");
    expect(chain.calls[0]?.name).toBe("insert");
    expect(chain.calls[1]).toMatchObject({
      name: "values",
      args: [
        {
          email: "ada@example.com",
          reason: "complained",
          detail: "spam complaint",
        },
      ],
    });
  });

  it("stores null rather than undefined when there is no detail", async () => {
    // `undefined` in a Drizzle values() is "leave the column out", which is a
    // different statement from "write NULL" and a different bug when it drifts.
    await suppress("ada@example.com", "bounced");
    expect((chain.calls[1]?.args[0] as { detail: unknown }).detail).toBeNull();
  });

  it("is idempotent — the second report of a dead address changes nothing", async () => {
    await suppress("ada@example.com", "bounced");
    expect(chain.calls.at(-1)?.name).toBe("onConflictDoNothing");
  });

  it("does NOT swallow a write failure", async () => {
    // The opposite choice from the read above, on purpose: the webhook needs to
    // answer 500 so the event is redelivered. Losing a bounce silently is how a
    // suppression list quietly stops being one.
    chain = drizzleChain(Promise.reject(new Error("write failed")));
    getDbImpl = () => chain.db;
    await expect(suppress("ada@example.com", "bounced")).rejects.toThrow(
      "write failed",
    );
  });
});
