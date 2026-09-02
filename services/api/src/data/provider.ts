/**
 * provider.ts — the ONE place services/api reads Kilimo data from.
 *
 * Contract, in priority order:
 *  1. Try Supabase (service-role key, server-side only) under a hard timeout
 *     AbortController timeout.
 *  2. On ANY failure — missing env, timeout, PostgREST error, empty result,
 *     unmappable row — fall back to the bundled snapshot shipped inside
 *     @terramavuno/shared (packages/shared/src/data/kilimo-fallback.json).
 *  3. Every payload declares which happened: dataMode 'supabase' | 'bundled'.
 *
 * The fallback is logged ONCE PER PROCESS (per reason), not per request, so a
 * keyless demo does not spam the console mid-presentation.
 *
 * Rows are mapped into the EXACT packages/shared eligibility types, so the
 * deterministic engine cannot tell the two sources apart:
 *   programmes(.metadata)      -> ProgrammeRules
 *   subsidy_prices             -> PriceRow[]
 *   infrastructure_assets      -> Depot[]
 *   farmer_tokens              -> FarmerToken[]
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import {
  KILIMO_DEPOTS,
  KILIMO_FARMERS,
  KILIMO_PRICES,
  KILIMO_PROGRAMME,
  haversineKm,
  type Depot,
  type EvidenceTag,
  type FarmerToken,
  type PriceRow,
  type ProgrammeRules,
  type RuleCriterion,
  type WardCentroid,
} from '../shared.js';
import { toLonLat } from './geo.js';

/* ------------------------------------------------------------------ */
/* Public shapes                                                       */
/* ------------------------------------------------------------------ */

export type DataMode = 'supabase' | 'bundled';

/** Every provider result carries its provenance badge. */
export interface Payload<T> {
  data: T;
  dataMode: DataMode;
}

/** A depot, optionally annotated with its distance from a requested ward. */
export type DepotWithDistance = Depot & { distanceKm?: number };

export interface KilimoProvider {
  getProgramme(): Promise<Payload<ProgrammeRules>>;
  /** Prices are gazetted nationally; `ward` is accepted for API symmetry. */
  getPriceSchedule(ward?: string): Promise<Payload<PriceRow[]>>;
  /** With a ward, depots come back nearest-first with distanceKm attached. */
  getDepots(ward?: string): Promise<Payload<DepotWithDistance[]>>;
  getFarmer(token: string): Promise<Payload<FarmerToken | null>>;
  listFarmers(): Promise<Payload<FarmerToken[]>>;
}

/** Hard ceiling on every Supabase read. The demo must never hang on a query. */
export const SUPABASE_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS ?? 6000);

/** Stable slug of the one programme the P0 demo serves. */
export const PROGRAMME_SLUG = 'ken-fert-subsidy-2026';

/* ------------------------------------------------------------------ */
/* Fallback logging — once per process, per reason                     */
/* ------------------------------------------------------------------ */

const announced = new Set<string>();

function announceFallback(scope: string, reason: string): void {
  const key = `${scope}:${reason}`;
  if (announced.has(key)) return;
  announced.add(key);
  console.warn(
    `[provider] Supabase unavailable for ${scope} (${reason}) — serving bundled snapshot (dataMode=bundled).`,
  );
}

/** Test-only: forget which fallbacks have been announced. */
export function resetFallbackLog(): void {
  announced.clear();
}

/** Test-only: how many distinct fallback reasons have been logged. */
export function fallbackLogSize(): number {
  return announced.size;
}

/* ------------------------------------------------------------------ */
/* Supabase client (lazy, cached)                                      */
/* ------------------------------------------------------------------ */

let cachedClient: SupabaseClient | null = null;
let cachedClientKey = '';

/** null when Supabase is not configured — the caller then uses the bundle. */
export function getSupabaseClient(): SupabaseClient | null {
  const url = env.supabaseUrl;
  const key = env.supabaseSecretKey;
  if (!url || !key) return null;
  const fingerprint = `${url}::${key.length}`;
  if (cachedClient && cachedClientKey === fingerprint) return cachedClient;
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedClientKey = fingerprint;
  return cachedClient;
}

/** Test-only: drop the memoised client so env changes take effect. */
export function resetSupabaseClient(): void {
  cachedClient = null;
  cachedClientKey = '';
}

/**
 * Run a Supabase read with a 1500 ms abort. Returns null on ANY failure —
 * the caller never sees an exception and always has a bundled answer ready.
 */
async function attempt<T>(
  scope: string,
  run: (client: SupabaseClient, signal: AbortSignal) => Promise<T | null>,
): Promise<T | null> {
  const client = getSupabaseClient();
  if (!client) {
    announceFallback(scope, 'not configured');
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
  try {
    const result = await Promise.race([
      run(client, controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error(`timeout after ${SUPABASE_TIMEOUT_MS}ms`));
        });
      }),
    ]);
    if (result === null) {
      announceFallback(scope, 'empty or unmappable result');
      return null;
    }
    return result;
  } catch (error) {
    const reason = controller.signal.aborted
      ? `timeout after ${SUPABASE_TIMEOUT_MS}ms`
      : error instanceof Error
        ? error.message
        : 'unknown error';
    announceFallback(scope, reason);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Row -> shared-type mappers                                          */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const obj = (v: unknown): Row =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};

/** ISO-normalise a date/timestamp column ('2026-08-14' -> full ISO instant). */
function toIso(value: unknown, endOfDay = false): string | null {
  const s = str(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return endOfDay ? `${s}T23:59:59Z` : `${s}T00:00:00Z`;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Normalise a stored evidence blob into a full EvidenceTag. The seeded
 * programme metadata writes freshness inline as `checkedAt`; the bundled JSON
 * writes a nested `freshness` object. Both are accepted, and a missing
 * timestamp becomes freshness 'unknown' rather than an invented 'current'.
 */
function toEvidence(raw: unknown, fallback: EvidenceTag): EvidenceTag {
  const e = obj(raw);
  if (Object.keys(e).length === 0) return fallback;

  const nested = obj(e['freshness']);
  const checkedAt = str(nested['checkedAt']) ?? str(e['checkedAt']);
  const status = str(nested['status']);
  const authority = str(e['authority']);
  const derivation = str(e['derivation']);

  return {
    authority:
      authority === 'official' || authority === 'reported' ? authority : fallback.authority,
    derivation:
      derivation === 'direct' ||
      derivation === 'calculated' ||
      derivation === 'inferred' ||
      derivation === 'simulated'
        ? derivation
        : fallback.derivation,
    freshness: {
      checkedAt,
      status:
        status === 'current' || status === 'stale' || status === 'unknown'
          ? status
          : checkedAt === null
            ? 'unknown'
            : 'current',
    },
    sourceId: str(e['sourceId']) ?? fallback.sourceId,
    citation: str(e['citation']) ?? fallback.citation,
  };
}

const KNOWN_TESTS = new Set([
  'in_register',
  'id_linked',
  'acreage_max',
  'ward_participating',
  'stock_available',
]);

/** programmes row (+ ward centroid rows) -> ProgrammeRules. */
export function mapProgrammeRow(
  row: Row,
  wardCentroids: Record<string, WardCentroid>,
): ProgrammeRules | null {
  const metadata = obj(row['metadata']);
  const rawCriteria = Array.isArray(metadata['criteria']) ? metadata['criteria'] : [];
  const criteria: RuleCriterion[] = [];
  for (const item of rawCriteria) {
    const c = obj(item);
    const id = str(c['id']);
    const test = str(c['test']);
    const label = str(c['label']);
    if (!id || !test || !label || !KNOWN_TESTS.has(test)) continue;
    const param = num(c['param']);
    criteria.push({
      id,
      label,
      test: test as RuleCriterion['test'],
      ...(param === null ? {} : { param }),
      evidence: toEvidence(
        c['evidence'],
        KILIMO_PROGRAMME.criteria.find((k) => k.id === id)?.evidence ?? KILIMO_PROGRAMME.evidence,
      ),
    });
  }
  if (criteria.length === 0) return null;

  const wards = Array.isArray(metadata['participatingWards'])
    ? metadata['participatingWards'].filter((w): w is string => typeof w === 'string')
    : [];
  if (wards.length === 0) return null;

  const formula = obj(metadata['allocationFormula']);
  const bagsPerAcre = num(formula['bagsPerAcre']);
  const maxBags = num(formula['maxBags']);
  if (bagsPerAcre === null || maxBags === null) return null;

  const name = str(row['name']);
  if (!name) return null;

  return {
    id: str(row['slug']) ?? str(metadata['slug']) ?? PROGRAMME_SLUG,
    name,
    season: str(metadata['season']) ?? KILIMO_PROGRAMME.season,
    participatingWards: wards,
    criteria,
    allocationFormula: { bagsPerAcre, maxBags },
    evidence: toEvidence(metadata['evidence'], KILIMO_PROGRAMME.evidence),
    wardCentroids:
      Object.keys(wardCentroids).length > 0 ? wardCentroids : KILIMO_PROGRAMME.wardCentroids,
  };
}

/** subsidy_prices row -> PriceRow. */
export function mapPriceRow(row: Row): PriceRow | null {
  const subsidized = num(row['subsidized_price_kes']);
  const market = num(row['market_price_kes']);
  if (subsidized === null || market === null) return null;
  const reference = KILIMO_PRICES[0];
  return {
    inputType: str(row['input_type']) ?? 'planting_fertilizer',
    subsidizedPriceKes: subsidized,
    marketPriceKes: market,
    bagWeightKg: num(row['bag_weight_kg']) ?? 50,
    validFrom: toIso(row['valid_from']) ?? reference.validFrom,
    validTo: toIso(row['valid_to'], true) ?? reference.validTo,
    evidence: toEvidence(obj(row['metadata'])['evidence'], reference.evidence),
  };
}

/** infrastructure_assets row -> Depot. The engine's depot id is metadata.slug. */
export function mapDepotRow(row: Row): Depot | null {
  const metadata = obj(row['metadata']);
  const id = str(metadata['slug']) ?? str(row['id']);
  const name = str(row['name']);
  const point = toLonLat(row['location'] ?? row['geometry']);
  if (!id || !name || !point) return null;

  const stockRaw = str(metadata['stock_status']);
  const stockStatus: Depot['stockStatus'] =
    stockRaw === 'in_stock' || stockRaw === 'low' || stockRaw === 'unknown' ? stockRaw : 'unknown';
  const checkedAt = toIso(metadata['checked_at']);
  const classification: Depot['classification'] =
    str(metadata['classification']) === 'official' ? 'official' : 'simulated';
  const bundled = KILIMO_DEPOTS.find((d) => d.id === id);

  return {
    id,
    name,
    lat: point.lat,
    lon: point.lon,
    merchant: str(metadata['merchant']) ?? name,
    assetType: str(row['asset_type']) === 'ncpb_depot' ? 'ncpb_depot' : 'agro_dealer',
    stockStatus,
    checkedAt,
    classification,
    evidence: toEvidence(metadata['evidence'], {
      authority: classification === 'official' ? 'official' : 'reported',
      derivation: classification === 'official' ? 'direct' : 'simulated',
      freshness: { checkedAt, status: checkedAt === null ? 'unknown' : 'current' },
      sourceId: bundled?.evidence.sourceId ?? 'supabase-infrastructure-assets',
      citation:
        bundled?.evidence.citation ??
        `${name} stock report${checkedAt === null ? ' (never checked)' : `, checked ${checkedAt}`}`,
    }),
  };
}

/** farmer_tokens row (joined to its ward and assigned depot) -> FarmerToken. */
export function mapFarmerRow(row: Row): FarmerToken | null {
  const token = str(row['token_code']);
  if (!token) return null;

  const attributes = obj(row['attributes']);
  // PostgREST embeds a to-one relation as an object, but older/looser configs
  // return a single-element array — accept both.
  const embed = (value: unknown): Row =>
    Array.isArray(value) ? obj(value[0]) : obj(value);
  const ward = embed(row['ward']);
  const depot = embed(row['depot']);
  const depotSlug = str(obj(depot['metadata'])['slug']);

  const stateRaw = str(row['state']);
  const state: FarmerToken['state'] =
    stateRaw === 'registered' ||
    stateRaw === 'missing_requirement' ||
    stateRaw === 'ineligible' ||
    stateRaw === 'unknown'
      ? stateRaw
      : 'unknown';

  const register = attributes['inFarmerRegister'];
  const bundled = KILIMO_FARMERS.find((f) => f.token === token);

  return {
    token,
    wardCode: str(ward['code']) ?? bundled?.wardCode ?? '',
    wardName: str(ward['name']) ?? bundled?.wardName ?? '',
    state,
    ...(depotSlug !== null ? { assignedDepotId: depotSlug } : {}),
    attributes: {
      // Anything that is not an explicit boolean is 'unknown' — never guessed.
      inFarmerRegister: register === true || register === false ? register : 'unknown',
      nationalIdLinked: attributes['nationalIdLinked'] === true,
      acreage: num(attributes['acreage']),
      crop: str(attributes['crop']) ?? 'maize',
      priorRedemptions: num(attributes['priorRedemptions']) ?? 0,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ward helpers                                                        */
/* ------------------------------------------------------------------ */

/** Ward-name matching is apostrophe/case/space tolerant ("Ng'araria"). */
export function wardKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bundledCentroids(): Record<string, WardCentroid> {
  return KILIMO_PROGRAMME.wardCentroids ?? {};
}

/** Nearest-first ordering of depots around a ward centroid (Derivation: calculated). */
function annotateByWard(
  depots: Depot[],
  ward: string | undefined,
  centroids: Record<string, WardCentroid>,
): DepotWithDistance[] {
  const copies: DepotWithDistance[] = depots.map((d) => ({ ...d }));
  if (ward === undefined) return copies;
  const key = wardKey(ward);
  const entry = Object.entries(centroids).find(([name]) => wardKey(name) === key);
  if (!entry) return copies;
  const centroid = entry[1];
  return copies
    .map((d) => ({
      ...d,
      distanceKm: Math.round(haversineKm(centroid.lat, centroid.lon, d.lat, d.lon) * 10) / 10,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** The PostgREST select for a farmer row plus its ward and assigned depot. */
const FARMER_SELECT =
  'token_code,state,attributes,' +
  'ward:administrative_areas!farmer_tokens_ward_area_id_fkey(name,code),' +
  'depot:infrastructure_assets!farmer_tokens_assigned_depot_id_fkey(metadata)';

/** Ward centroids from administrative_areas; {} when unavailable. */
async function fetchWardCentroids(
  client: SupabaseClient,
  signal: AbortSignal,
): Promise<Record<string, WardCentroid>> {
  const { data, error } = await client
    .from('administrative_areas')
    .select('name,code,centroid')
    .eq('level', 'ward')
    .abortSignal(signal);
  if (error || !Array.isArray(data)) return {};
  const out: Record<string, WardCentroid> = {};
  for (const raw of data) {
    const row = obj(raw);
    const name = str(row['name']);
    const point = toLonLat(row['centroid']);
    if (name === null || point === null) continue;
    const code = str(row['code']);
    out[name] = { ...(code === null ? {} : { wardCode: code }), lat: point.lat, lon: point.lon };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The provider                                                        */
/* ------------------------------------------------------------------ */

export const provider: KilimoProvider = {
  async getProgramme(): Promise<Payload<ProgrammeRules>> {
    const data = await attempt('programme', async (client, signal) => {
      const { data: rows, error } = await client
        .from('programmes')
        .select('slug,name,metadata')
        .eq('slug', PROGRAMME_SLUG)
        .limit(1)
        .abortSignal(signal);
      if (error) throw new Error(error.message);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (row === undefined) return null;
      const centroids = await fetchWardCentroids(client, signal);
      return mapProgrammeRow(obj(row), centroids);
    });
    return data === null
      ? { data: KILIMO_PROGRAMME, dataMode: 'bundled' }
      : { data, dataMode: 'supabase' };
  },

  async getPriceSchedule(_ward?: string): Promise<Payload<PriceRow[]>> {
    const data = await attempt('prices', async (client, signal) => {
      const { data: rows, error } = await client
        .from('subsidy_prices')
        .select(
          // NOTE: subsidy_prices has no `metadata` column (see
          // supabase/migrations/20260903000000_kilimo_subsidy.sql) — selecting
          // it makes PostgREST reject the whole query and silently fall back.
          'input_type,subsidized_price_kes,market_price_kes,bag_weight_kg,bags_per_acre,allocation_bags_max,valid_from,valid_to,classification',
        )
        .abortSignal(signal);
      if (error) throw new Error(error.message);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const mapped = rows.map((r) => mapPriceRow(obj(r))).filter((p): p is PriceRow => p !== null);
      return mapped.length > 0 ? mapped : null;
    });
    return data === null
      ? { data: KILIMO_PRICES, dataMode: 'bundled' }
      : { data, dataMode: 'supabase' };
  },

  async getDepots(ward?: string): Promise<Payload<DepotWithDistance[]>> {
    const result = await attempt('depots', async (client, signal) => {
      const { data: rows, error } = await client
        .from('infrastructure_assets')
        .select('id,name,asset_type,location,metadata')
        .in('asset_type', ['ncpb_depot', 'agro_dealer'])
        .abortSignal(signal);
      if (error) throw new Error(error.message);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const depots = rows.map((r) => mapDepotRow(obj(r))).filter((d): d is Depot => d !== null);
      if (depots.length === 0) return null;
      const centroids = await fetchWardCentroids(client, signal);
      return {
        depots,
        centroids: Object.keys(centroids).length > 0 ? centroids : bundledCentroids(),
      };
    });
    return result === null
      ? { data: annotateByWard(KILIMO_DEPOTS, ward, bundledCentroids()), dataMode: 'bundled' }
      : { data: annotateByWard(result.depots, ward, result.centroids), dataMode: 'supabase' };
  },

  async getFarmer(token: string): Promise<Payload<FarmerToken | null>> {
    const wanted = token.trim();
    const data = await attempt('farmer', async (client, signal) => {
      const { data: rows, error } = await client
        .from('farmer_tokens')
        .select(FARMER_SELECT)
        .eq('token_code', wanted)
        .limit(1)
        .abortSignal(signal);
      if (error) throw new Error(error.message);
      const row = Array.isArray(rows) ? rows[0] : undefined;
      if (row === undefined) return null;
      return mapFarmerRow(obj(row));
    });
    if (data !== null) return { data, dataMode: 'supabase' };
    const bundled = KILIMO_FARMERS.find(
      (f) => f.token.toUpperCase() === wanted.toUpperCase(),
    );
    return { data: bundled ?? null, dataMode: 'bundled' };
  },

  async listFarmers(): Promise<Payload<FarmerToken[]>> {
    const data = await attempt('farmers', async (client, signal) => {
      const { data: rows, error } = await client
        .from('farmer_tokens')
        .select(FARMER_SELECT)
        .order('token_code', { ascending: true })
        .abortSignal(signal);
      if (error) throw new Error(error.message);
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const mapped = rows
        .map((r) => mapFarmerRow(obj(r)))
        .filter((f): f is FarmerToken => f !== null);
      return mapped.length > 0 ? mapped : null;
    });
    return data === null
      ? { data: KILIMO_FARMERS, dataMode: 'bundled' }
      : { data, dataMode: 'supabase' };
  },
};

/** Weakest link wins: any bundled component makes the whole answer bundled. */
export function combineDataMode(...modes: DataMode[]): DataMode {
  return modes.includes('bundled') ? 'bundled' : 'supabase';
}
