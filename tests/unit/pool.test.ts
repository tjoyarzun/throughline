import { describe, it, expect } from 'vitest';
import { mapPool } from '@/lib/pool';

describe('mapPool', () => {
  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(
      Array.from({ length: 50 }, (_, i) => i),
      8,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
      },
    );
    expect(peak).toBeLessThanOrEqual(8);
    // And it must actually run things in parallel, or it is just a slow loop --
    // which is the defect it was written to fix.
    expect(peak).toBeGreaterThan(1);
  });

  it('returns results in INPUT order, not completion order', async () => {
    // Deliberately inverted timing: the last item finishes first.
    const out = await mapPool([30, 20, 10, 0], 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapPool([], 8, async () => 1)).toEqual([]);
    expect(await mapPool([1, 2], 99, async (n) => n * 2)).toEqual([2, 4]);
  });

  it('propagates a rejection rather than swallowing it', async () => {
    await expect(
      mapPool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
