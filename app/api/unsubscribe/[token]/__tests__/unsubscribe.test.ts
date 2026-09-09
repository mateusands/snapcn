/**
 * Unit tests for app/api/unsubscribe/[token]/route.ts
 *
 * Run with:  pnpm vitest run "app/api/unsubscribe"
 *
 * One rule holds this endpoint together and every case below is a way of
 * breaking it: **GET must never unsubscribe anybody.** Gmail, Outlook and
 * corporate security gateways fetch every URL in a message before a human sees
 * it, so a GET with a side effect empties the list from the inside and the
 * symptom — "our open rate collapsed" — points nowhere near the cause.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  unsubscribed: [] as string[],
  throws: false,
}));

vi.mock("@/lib/server/subscription", () => ({
  unsubscribeByToken: async (token: string) => {
    if (h.throws) throw new Error("db down");
    h.unsubscribed.push(token);
  },
}));

import { GET, POST } from "@/app/api/unsubscribe/[token]/route";

const TOKEN = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const params = (token = TOKEN) => ({ params: Promise.resolve({ token }) });

function req(method: "GET" | "POST", accept?: string) {
  return new Request(`https://snapcn.dev/api/unsubscribe/${TOKEN}`, {
    method,
    headers: accept ? { accept } : {},
  });
}

beforeEach(() => {
  h.unsubscribed = [];
  h.throws = false;
});

describe("GET", () => {
  it("never writes — it only points at the page with the button on it", async () => {
    const res = await GET(req("GET"), params());
    expect(h.unsubscribed).toEqual([]);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://snapcn.dev/u/${TOKEN}`);
  });

  it("does not write for a link scanner sending an HTML Accept either", async () => {
    await GET(req("GET", "text/html,application/xhtml+xml"), params());
    expect(h.unsubscribed).toEqual([]);
  });
});

describe("POST", () => {
  it("unsubscribes, and answers a machine with a plain 200", async () => {
    // Gmail's one-click reads nothing but the status. A 3xx or a 4xx here gets
    // the message flagged as broken by the sender's own reputation tooling.
    const res = await POST(req("POST"), params());
    expect(h.unsubscribed).toEqual([TOKEN]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("sends a browser back to the page with the outcome on it", async () => {
    const res = await POST(req("POST", "text/html,*/*"), params());
    expect(h.unsubscribed).toEqual([TOKEN]);
    // 303 and not 307: the browser must follow with GET, or the form re-POSTs
    // to a page and gets a 405.
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      `https://snapcn.dev/u/${TOKEN}?done=1`,
    );
  });

  it("still answers 200 when the token is junk", async () => {
    // There is nothing a retry could fix, and an error status is read as "this
    // sender's unsubscribe is broken".
    for (const junk of ["", "nope", `${TOKEN}x`]) {
      const res = await POST(req("POST"), params(junk));
      expect(res.status, junk).toBe(200);
    }
  });

  it("still answers 200 when the database is down", async () => {
    h.throws = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("POST"), params());
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("passes the token through untouched, so validation stays in one place", async () => {
    await POST(req("POST"), params("Not-A-Token"));
    expect(h.unsubscribed).toEqual(["Not-A-Token"]);
  });
});
