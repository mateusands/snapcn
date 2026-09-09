/**
 * A stand-in for a Drizzle query builder.
 *
 * Drizzle's builders are chains that are also promises — `db.update(t).set(x)
 * .where(y).returning(z)` is awaited at the end, and `db.insert(t).values(x)
 * .onConflictDoNothing(y)` is awaited in the middle. Mocking that with hand
 * written objects means writing the same six-method shape in every test file
 * and getting the thenable wrong once.
 *
 * So: one Proxy that answers every method with itself, resolves to a value you
 * choose, and records what it was asked to do. Enough to assert the two things
 * these tests actually care about — that a statement was issued at all, and
 * what came back — without pretending to be a database.
 */

export interface ChainCall {
  name: string;
  args: unknown[];
}

export interface Chain {
  /** Every method called on this chain, in order. */
  calls: ChainCall[];
  /** The chain itself, typed loosely so it can stand in for `getDb()`. */
  // biome-ignore lint/suspicious/noExplicitAny: a stub for an untyped builder
  db: any;
}

/**
 * `results` is consumed one per *terminal* await. Pass several when a single
 * code path issues several statements — the subscribe route's insert-then-claim
 * is the reason this is a queue and not a single value.
 */
export function drizzleChain(...results: unknown[]): Chain {
  const calls: ChainCall[] = [];
  const queue = [...results];

  // biome-ignore lint/suspicious/noExplicitAny: the Proxy is deliberately untyped
  const node: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          const value = queue.length > 1 ? queue.shift() : queue[0];
          return (
            // biome-ignore lint/suspicious/noExplicitAny: promise callbacks
            resolve: any,
            // biome-ignore lint/suspicious/noExplicitAny: promise callbacks
            reject: any,
          ) => Promise.resolve(value).then(resolve, reject);
        }
        if (prop === "calls") return calls;
        return (...args: unknown[]) => {
          calls.push({ name: String(prop), args });
          return node;
        };
      },
    },
  );

  return { calls, db: node };
}

/** Did the chain issue a statement of this kind? */
export function called(chain: Chain, name: string): boolean {
  return chain.calls.some((c) => c.name === name);
}
