type QueuedResult = unknown[] | Error;

let resultQueue: QueuedResult[] = [];

/**
 * Queue the results that the mock `db` will return, in the exact order the
 * route handler awaits its drizzle queries. Each awaited query chain
 * (e.g. `db.select().from().where()` or `db.insert().values().returning()`)
 * consumes one entry. An `Error` entry makes that query reject, which is how
 * we simulate a database failure (500).
 */
export function queueDbResults(...results: QueuedResult[]): void {
  resultQueue.push(...results);
}

export function resetDbMock(): void {
  resultQueue = [];
}

function takeResult(): Promise<unknown[]> {
  const next = resultQueue.shift();
  if (next === undefined) return Promise.resolve([]);
  if (next instanceof Error) return Promise.reject(next);
  return Promise.resolve(next);
}

/**
 * Builds a chainable, thenable stand-in for a drizzle query builder. Every
 * builder method (`from`, `where`, `orderBy`, `limit`, `set`, `values`,
 * `returning`, ...) returns the same chain, and awaiting the chain resolves to
 * the next queued result.
 */
function makeChainable(): unknown {
  const chain: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") {
        return (
          resolve: (value: unknown[]) => unknown,
          reject: (reason: unknown) => unknown,
        ) => takeResult().then(resolve, reject);
      }
      return () => chain;
    },
    apply() {
      return chain;
    },
  });
  return chain;
}

export const mockDb = {
  select: () => makeChainable(),
  insert: () => makeChainable(),
  update: () => makeChainable(),
  delete: () => makeChainable(),
};
