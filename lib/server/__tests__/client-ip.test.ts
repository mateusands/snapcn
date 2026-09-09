/**
 * Unit tests for lib/server/client-ip.ts
 *
 * Run with:  pnpm vitest run lib/server/__tests__/client-ip.test.ts
 *
 * This function decides which bucket a request spends, so every case here is a
 * way of getting a free one. It had no tests while it lived inside the render
 * route; it got them the moment a second caller — the signup form, where the
 * budget is what stops us mailing a stranger — started depending on it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clientIp } from "@/lib/server/client-ip";

function req(headers: Record<string, string>): Request {
  return new Request("https://snapcn.dev/api/subscribe", { headers });
}

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("clientIp", () => {
  it("takes the LAST hop, which is the only one a caller cannot write", () => {
    // The whole point. `x-forwarded-for` is a request header: under a proxy
    // that appends, the caller supplies everything before our own entry. Taking
    // the first hop lets them rotate it per request and reset the bucket.
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
    expect(
      clientIp(req({ "x-forwarded-for": "evil, evil, evil, 203.0.113.7" })),
    ).toBe("203.0.113.7");
  });

  it("handles the single-value case every managed platform sends", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("tolerates the whitespace and empty entries proxies leave behind", () => {
    expect(
      clientIp(req({ "x-forwarded-for": " 9.9.9.9 , , 203.0.113.7 " })),
    ).toBe("203.0.113.7");
  });

  it("skips our own trailing hops when TRUSTED_PROXY_HOPS says to", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(
      clientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7, 10.0.0.1" })),
    ).toBe("203.0.113.7");
  });

  it("never walks off the front of the list when the skip is too large", () => {
    // A misconfigured hop count must degrade to *some* address rather than
    // `undefined`, or every request shares one bucket named "undefined".
    process.env.TRUSTED_PROXY_HOPS = "9";
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("ignores a nonsense hop count instead of trusting it", () => {
    for (const bad of ["-1", "0", "abc", ""]) {
      process.env.TRUSTED_PROXY_HOPS = bad;
      expect(
        clientIp(req({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" })),
        bad,
      ).toBe("203.0.113.7");
    }
  });

  it("falls back to x-real-ip, then to a constant", () => {
    expect(clientIp(req({ "x-real-ip": " 203.0.113.7 " }))).toBe("203.0.113.7");
    expect(clientIp(req({}))).toBe("unknown");
    // An empty header must not become an empty bucket key.
    expect(clientIp(req({ "x-forwarded-for": "", "x-real-ip": "" }))).toBe(
      "unknown",
    );
  });
});
