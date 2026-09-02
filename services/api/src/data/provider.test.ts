/**
 * The provider must ALWAYS answer, even when Supabase is missing or slow —
 * the demo cannot depend on a network. These tests pin both failure paths and
 * the once-per-process fallback logging.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createClientMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args) as unknown,
}));

const {
  provider,
  resetFallbackLog,
  resetSupabaseClient,
  SUPABASE_TIMEOUT_MS,
  wardKey,
} = await import('./provider.js');
const { decodeEwkbHexPoint } = await import('./geo.js');
const { KILIMO_FARMERS, KILIMO_PROGRAMME } = await import('../shared.js');

/** A PostgREST-style thenable builder whose promise we control. */
function builder(promise: Promise<unknown>): Record<string, unknown> {
  const self: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'limit', 'order', 'abortSignal']) {
    self[method] = () => self;
  }
  self['then'] = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    promise.then(onFulfilled, onRejected);
  return self;
}

const originalEnv = { ...process.env };

beforeEach(() => {
  resetFallbackLog();
  resetSupabaseClient();
  createClientMock.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('provider fallback', () => {
  it('serves bundled data when Supabase is not configured', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;

    const programme = await provider.getProgramme();
    expect(programme.dataMode).toBe('bundled');
    expect(programme.data.id).toBe(KILIMO_PROGRAMME.id);

    const farmers = await provider.listFarmers();
    expect(farmers.dataMode).toBe('bundled');
    expect(farmers.data.map((f) => f.token)).toContain('K-004');

    // No Supabase client is even constructed without credentials.
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('logs the fallback once per process, not once per request', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await provider.getProgramme();
    await provider.getProgramme();
    await provider.getProgramme();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('dataMode=bundled');
  });

  it('falls back to bundled data when a Supabase read exceeds the timeout budget', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-secret-key';

    // A query that never settles inside the timeout window.
    const never = new Promise<unknown>((resolve) => {
      setTimeout(() => resolve({ data: [], error: null }), SUPABASE_TIMEOUT_MS * 4);
    });
    createClientMock.mockReturnValue({ from: () => builder(never) });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const started = Date.now();
    const result = await provider.getFarmer('K-001');
    const elapsed = Date.now() - started;

    expect(result.dataMode).toBe('bundled');
    expect(result.data?.token).toBe('K-001');
    expect(elapsed).toBeLessThan(SUPABASE_TIMEOUT_MS * 3);
    expect(createClientMock).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('falls back when Supabase returns a PostgREST error', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
    createClientMock.mockReturnValue({
      from: () =>
        builder(Promise.resolve({ data: null, error: { message: 'relation does not exist' } })),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const depots = await provider.getDepots();
    expect(depots.dataMode).toBe('bundled');
    expect(depots.data.length).toBeGreaterThan(0);
  });

  it('falls back when Supabase returns an empty result set', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
    createClientMock.mockReturnValue({
      from: () => builder(Promise.resolve({ data: [], error: null })),
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const prices = await provider.getPriceSchedule();
    expect(prices.dataMode).toBe('bundled');
    expect(prices.data[0]?.subsidizedPriceKes).toBe(2500);
  });

  it('returns null (not a guess) for an unknown farmer token', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const result = await provider.getFarmer('K-999');
    expect(result.data).toBeNull();
    expect(result.dataMode).toBe('bundled');
  });

  it('orders depots nearest-first for a ward', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const { data } = await provider.getDepots("Ng'araria");
    const distances = data.map((d) => d.distanceKm);
    expect(distances.every((d) => typeof d === 'number')).toBe(true);
    expect([...distances]).toEqual([...distances].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});

describe('helpers', () => {
  it('matches ward names regardless of apostrophes and case', () => {
    expect(wardKey("Ng'araria")).toBe(wardKey('ngararia'));
    expect(wardKey('Kagundu-ini')).toBe(wardKey('kagunduini'));
  });

  it('decodes a hex EWKB point as lon/lat', () => {
    // Build SRID-4326 POINT(37.20 -0.66) exactly as PostGIS emits it.
    const buf = Buffer.alloc(25);
    buf.writeUInt8(1, 0); // little-endian
    buf.writeUInt32LE(0x20000001, 1); // POINT + SRID flag
    buf.writeUInt32LE(4326, 5);
    buf.writeDoubleLE(37.2, 9);
    buf.writeDoubleLE(-0.66, 17);

    const point = decodeEwkbHexPoint(buf.toString('hex'));
    expect(point?.lon).toBeCloseTo(37.2, 6);
    expect(point?.lat).toBeCloseTo(-0.66, 6);
  });

  it('rejects non-point / malformed geometry without throwing', () => {
    expect(decodeEwkbHexPoint('not-hex')).toBeNull();
    expect(decodeEwkbHexPoint('0101')).toBeNull();
  });

  it('bundled fixtures still contain the four demo tokens', () => {
    for (const token of ['K-001', 'K-002', 'K-003', 'K-004']) {
      expect(KILIMO_FARMERS.some((f) => f.token === token)).toBe(true);
    }
  });
});
