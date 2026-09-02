/**
 * Minimal PostGIS point decoding.
 *
 * Supabase's REST API returns `geography(point,4326)` columns as hex-encoded
 * EWKB strings (e.g. "0101000020E6100000..."), so depot and ward-centroid
 * coordinates need decoding before they can enter the eligibility engine.
 * Only the POINT case is supported — that is all the Kilimo schema stores in
 * infrastructure_assets.location and administrative_areas.centroid. GeoJSON
 * objects (what PostgREST returns when a view already casts to json) are
 * handled too, so the provider works either way.
 */

export interface LonLat {
  lon: number;
  lat: number;
}

/** WKB geometry type code for POINT, after masking off SRID/Z/M flags. */
const WKB_POINT = 1;

/** Decode a hex EWKB POINT. Returns null for anything else (never throws). */
export function decodeEwkbHexPoint(hex: string): LonLat | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 42) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(hex, 'hex');
  } catch {
    return null;
  }
  if (bytes.length < 21) return null;

  const littleEndian = bytes[0] === 1;
  const rawType = littleEndian ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
  // Low 16 bits carry the geometry type; high bits are the SRID/Z/M flags.
  if ((rawType & 0xffff) !== WKB_POINT) return null;

  const hasSrid = (rawType & 0x20000000) !== 0;
  const offset = 5 + (hasSrid ? 4 : 0);
  if (bytes.length < offset + 16) return null;

  const lon = littleEndian ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);
  const lat = littleEndian
    ? bytes.readDoubleLE(offset + 8)
    : bytes.readDoubleBE(offset + 8);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

/**
 * Best-effort lon/lat extraction from whatever shape a PostGIS point column
 * arrives in: hex EWKB string, GeoJSON `{type:'Point',coordinates:[lon,lat]}`,
 * or a plain `{lon,lat}` / `{longitude,latitude}` object.
 */
export function toLonLat(value: unknown): LonLat | null {
  if (typeof value === 'string') return decodeEwkbHexPoint(value);
  if (value === null || typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;
  const coords = obj['coordinates'];
  if (Array.isArray(coords) && coords.length >= 2) {
    const [lon, lat] = coords;
    if (typeof lon === 'number' && typeof lat === 'number') return { lon, lat };
  }
  const lon = obj['lon'] ?? obj['longitude'] ?? obj['x'];
  const lat = obj['lat'] ?? obj['latitude'] ?? obj['y'];
  if (typeof lon === 'number' && typeof lat === 'number') return { lon, lat };
  return null;
}
