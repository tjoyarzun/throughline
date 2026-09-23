/**
 * Run an async function over a list with a bounded number in flight.
 *
 * Not Promise.all: that starts everything at once, which against a rate
 * limiter means hundreds of calls queueing behind a token bucket with no
 * backpressure, and against a connection pool means starvation. Not a serial
 * loop either -- that was the actual defect this exists to fix. Hydrating
 * people one at a time spent 162ms per person waiting on the network while a
 * limiter that permits 30 requests a second sat idle, so a walk that should
 * take half an hour was quoted in weeks.
 *
 * Results come back in input order regardless of completion order, because a
 * caller that has to re-associate results with inputs will eventually get it
 * wrong.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
