/**
 * Unit tests for app/api/webhooks/resend/route.ts
 *
 * Run with:  pnpm vitest run app/api/webhooks/resend/__tests__
 *
 * The signature is generated here rather than mocked, from the same spec the
 * verifier implements. That matters more than usual for this endpoint: a forged
 * `email.bounced` naming somebody else's address adds them to the suppression
 * list, and their sign-in link is never sent again. It is a denial of service
 * against one account, delivered by a POST with no credentials.
 *
 * The status codes are the other half. Resend retries anything that is not 2xx,
 * so a code here is an instruction — "try this again" or "never again" — and
 * both wrong answers are silent.
 */

import { createHmac, randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  configured: true,
  suppressed: [] as Array<{ email: string; reason: string; detail?: string }>,
  suppressThrows: false,
  updates: 0,
  updateThrows: false,
}));

vi.mock("@/lib/server/db", () => ({
  get isDbConfigured() {
    return h.configured;
  },
  getDb: () => ({
    update: () => ({
      set: () => ({
        where: async () => {
          if (h.updateThrows) throw new Error("db down");
          h.updates += 1;
        },
      }),
    }),
  }),
}));

vi.mock("@/lib/server/suppression", () => ({
  suppress: async (email: string, reason: string, detail?: string) => {
    if (h.suppressThrows) throw new Error("write failed");
    h.suppressed.push({ email, reason, detail });
  },
}));

import { POST } from "@/app/api/webhooks/resend/route";

/** A realistic secret: `whsec_` on the front, base64 key bytes behind it. */
const KEY = randomBytes(32);
const SECRET = `whsec_${KEY.toString("base64")}`;

function signed(body: unknown, secret = SECRET, skewSeconds = 0): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const id = "msg_1";
  const ts = Math.floor(Date.now() / 1000) + skewSeconds;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key)
    .update(`${id}.${ts}.${raw}`)
    .digest("base64");
  return new Request("https://snapcn.dev/api/webhooks/resend", {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sig}`,
    },
    body: raw,
  });
}

const BOUNCE = {
  type: "email.bounced",
  data: {
    to: ["ada@example.com"],
    bounce: { type: "Permanent", subType: "General", message: "no such user" },
  },
};

beforeEach(() => {
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  h.configured = true;
  h.suppressed = [];
  h.suppressThrows = false;
  h.updates = 0;
  h.updateThrows = false;
});

describe("the trust boundary", () => {
  it("refuses to run at all without a secret", async () => {
    // The tempting branch is "no secret, so accept the event". It works
    // perfectly in dev and is a hole with a two-year fuse.
    delete process.env.RESEND_WEBHOOK_SECRET;
    const res = await POST(signed(BOUNCE));
    expect(res.status).toBe(503);
    expect(h.suppressed).toHaveLength(0);
  });

  it("rejects an unsigned request", async () => {
    const res = await POST(
      new Request("https://snapcn.dev/api/webhooks/resend", {
        method: "POST",
        body: JSON.stringify(BOUNCE),
      }),
    );
    expect(res.status).toBe(401);
    expect(h.suppressed).toHaveLength(0);
  });

  it("rejects a signature made with a different secret", async () => {
    const other = `whsec_${randomBytes(32).toString("base64")}`;
    expect((await POST(signed(BOUNCE, other))).status).toBe(401);
    expect(h.suppressed).toHaveLength(0);
  });

  it("rejects a body edited after signing", async () => {
    // The reason the raw text is read once and verified before parsing.
    const req = signed(BOUNCE);
    const tampered = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({
        ...BOUNCE,
        data: { ...BOUNCE.data, to: ["victim@example.com"] },
      }),
    });
    expect((await POST(tampered)).status).toBe(401);
    expect(h.suppressed).toHaveLength(0);
  });

  it("rejects a replay from outside the tolerance window", async () => {
    expect((await POST(signed(BOUNCE, SECRET, -3600))).status).toBe(401);
    expect((await POST(signed(BOUNCE, SECRET, 3600))).status).toBe(401);
  });

  it("answers 400 to a signed body that is not JSON", async () => {
    // Signed but unparseable is a broken sender; retrying cannot fix it.
    expect((await POST(signed("{"))).status).toBe(400);
  });
});

describe("what it does with an event", () => {
  it("suppresses a permanent bounce", async () => {
    const res = await POST(signed(BOUNCE));
    expect(res.status).toBe(200);
    expect(h.suppressed).toEqual([
      {
        email: "ada@example.com",
        reason: "bounced",
        detail: "permanent/General",
      },
    ]);
    // A bounce is not a preference — the row stays on the list.
    expect(h.updates).toBe(0);
  });

  it("suppresses a complaint AND takes them off the list", async () => {
    // Somebody pressed "Report spam". They have said both things at once, and
    // the two live in different places.
    const res = await POST(
      signed({ type: "email.complained", data: { to: ["ada@example.com"] } }),
    );
    expect(res.status).toBe(200);
    expect(h.suppressed[0]).toMatchObject({ reason: "complained" });
    expect(h.updates).toBe(1);
  });

  it("answers 200 and writes nothing for an event it has no use for", async () => {
    // 200, not 4xx: no number of redeliveries will make `email.delivered`
    // interesting, and a 4xx puts it in the retry queue for days.
    for (const event of [
      { type: "email.delivered", data: { to: ["ada@example.com"] } },
      { type: "email.opened", data: { to: ["ada@example.com"] } },
      {
        type: "email.bounced",
        data: { to: ["ada@example.com"], bounce: { type: "Transient" } },
      },
      {},
    ]) {
      const res = await POST(signed(event));
      expect(res.status, JSON.stringify(event)).toBe(200);
    }
    expect(h.suppressed).toHaveLength(0);
    expect(h.updates).toBe(0);
  });
});

describe("failures that should come back", () => {
  it("answers 500 when there is nowhere to write", async () => {
    // Rather than dropping the event during a migration.
    h.configured = false;
    expect((await POST(signed(BOUNCE))).status).toBe(500);
  });

  it("answers 500 when the suppression write fails", async () => {
    h.suppressThrows = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(signed(BOUNCE))).status).toBe(500);
  });

  it("answers 500 when the unsubscribe half of a complaint fails", async () => {
    h.updateThrows = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(
      signed({ type: "email.complained", data: { to: ["ada@example.com"] } }),
    );
    expect(res.status).toBe(500);
  });
});
