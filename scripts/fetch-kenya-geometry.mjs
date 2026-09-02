#!/usr/bin/env node
/**
 * fetch-kenya-geometry.mjs — TerraMavuno Kenya geometry pipeline
 * ==============================================================
 *
 * Downloads Kenya administrative boundaries, filters to Murang'a county and
 * its wards (Kandara constituency verified against references/kenya-locations),
 * simplifies to stage-demo size, and writes three bundled offline files:
 *
 *   apps/globe/src/data/local_data/kenya/counties.geojson       (ADM1, all 47)
 *   apps/globe/src/data/local_data/kenya/muranga_wards.geojson  (ADM3, Murang'a)
 *   apps/globe/src/data/local_data/kenya/centroids.json         (Kandara wards + Murang'a)
 *
 * SOURCES (in order of preference)
 * --------------------------------
 * ADM1 counties:
 *   geoBoundaries gbOpen KEN ADM1 (underlying source RCMRD GeoPortal, licence
 *   reported "Public Domain"; geoBoundaries asks for CC BY 4.0-style citation):
 *     https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/
 *   The API JSON exposes `gjDownloadURL` (full) and `simplifiedGeometryGeoJSON`
 *   (pre-simplified — we use this one).
 *
 * ADM3 wards:
 *   1. geoBoundaries gbOpen KEN ADM3 — attempted first, but as of 2026-09-02
 *      geoBoundaries publishes Kenya only to ADM2 (sub-counties), so this
 *      normally yields nothing and we fall through.
 *   2. tigawanna/kenya_wards_geojson_data (GitHub, MIT licence) — all 1,450
 *      IEBC wards as GeoJSON (~34 MB, filtered here to Murang'a):
 *        https://raw.githubusercontent.com/tigawanna/kenya_wards_geojson_data/main/src/data/wards/wards.geojson
 *   3. Documented manual alternative (SHP zip — NOT auto-parsed by this
 *      script; convert with mapshaper/ogr2ogr if you prefer it):
 *      HDX "kenya-admin-level-3-wards" (OCHA ROSEA, CC BY, IEBC-derived):
 *        https://data.humdata.org/dataset/db0ba5f4-cd9a-4512-b9ca-3c79f59fed08/resource/2fe6fcaa-58af-4d5d-a17d-81c73574ae2a/download/kenya_wards.zip
 *
 * Names/codes are joined against references/kenya-locations (MIT):
 *   counties.json (Murang'a = 021), constituencies.json (Kandara = 109),
 *   wards.json (0539 Ng'araria, 0540 Muruka, 0541 Kagundu-ini,
 *   0542 Gaichanjiru, 0543 Ithiru, 0544 Ruchu). wards.json links wards only
 *   to a constituency NAME, so ward -> county is a two-hop join through
 *   constituencies.json. Matching is name-normalised (case, apostrophes,
 *   hyphens, whitespace stripped) and every miss is logged.
 *
 * FLAGS
 * -----
 *   --offline    Skip all downloads. Keep existing committed files intact
 *                (regenerates centroids.json from the committed geometry if
 *                present). Exit 0.
 *   --supabase   After writing files, print (and structurally prepare) the
 *                upserts that would populate the `administrative_areas`
 *                table. The schema is owned by another workstream, so this
 *                flag LOGS the SQL/RPC calls instead of executing them.
 *   --max-kb=N   Per-file size budget (default 380 KB). Geometry is
 *                decimated (every-other-vertex) until it fits.
 *
 * FAILURE POLICY (never break the build)
 * --------------------------------------
 * Any network or parse failure logs a clear warning and exits 0. Committed
 * files are never deleted. If a layer has no committed file AND cannot be
 * downloaded, a clearly-labelled APPROXIMATE fallback is generated
 * (properties.approximate = true, properties.classification = "simulated")
 * so the demo still renders with zero network — but is never presented as
 * official geometry.
 *
 * Run:  node scripts/fetch-kenya-geometry.mjs [--offline] [--supabase]
 */

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'apps/globe/src/data/local_data/kenya');
const REF_DIR = path.join(REPO_ROOT, 'references/kenya-locations/data');

const ARGS = new Set(process.argv.slice(2).filter((a) => !a.startsWith('--max-kb')));
const OFFLINE = ARGS.has('--offline');
const SUPABASE = ARGS.has('--supabase');
const MAX_KB = Number(
  (process.argv.find((a) => a.startsWith('--max-kb=')) || '--max-kb=380').split('=')[1],
);
const MAX_BYTES = MAX_KB * 1024;

const GEOBOUNDARIES_ADM1_API = 'https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/';
const GEOBOUNDARIES_ADM3_API = 'https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM3/';
const WARDS_GEOJSON_URL =
  'https://raw.githubusercontent.com/tigawanna/kenya_wards_geojson_data/main/src/data/wards/wards.geojson';
// Documented manual fallback (SHP — needs external conversion, see header):
const HDX_WARDS_SHP_URL =
  'https://data.humdata.org/dataset/db0ba5f4-cd9a-4512-b9ca-3c79f59fed08/resource/2fe6fcaa-58af-4d5d-a17d-81c73574ae2a/download/kenya_wards.zip';

const MURANGA_COUNTY_CODE = '021';
const MURANGA_COUNTY_NAME = "Murang'a";
const KANDARA_CONSTITUENCY = 'Kandara';

/* ------------------------------------------------------------------ */
/* small utilities                                                     */
/* ------------------------------------------------------------------ */

const log = (...a) => console.log('[kenya-geometry]', ...a);
const warn = (...a) => console.warn('[kenya-geometry] WARNING:', ...a);

/** Normalise a place name for joining: lowercase, strip apostrophes/backticks,
 *  hyphens, slashes, dots and whitespace. "Ng'araria" === "NGARARIA" etc. */
function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[-_/.\s]+/g, '');
}

async function fetchJson(url, what) {
  log(`downloading ${what}: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Round every coordinate in a geometry to 5 decimals (~1.1 m). */
function roundGeometry(geom, decimals = 5) {
  const f = 10 ** decimals;
  const rc = (c) =>
    Array.isArray(c[0]) ? c.map(rc) : [Math.round(c[0] * f) / f, Math.round(c[1] * f) / f];
  return { ...geom, coordinates: rc(geom.coordinates) };
}

/** Drop every other vertex of each ring (keeping rings closed and >= 5 pts). */
function decimateGeometry(geom) {
  const thinRing = (ring) => {
    if (ring.length <= 8) return ring;
    const kept = ring.filter((_, i) => i % 2 === 0);
    if (kept[0][0] !== kept[kept.length - 1][0] || kept[0][1] !== kept[kept.length - 1][1]) {
      kept.push([...kept[0]]);
    }
    return kept.length >= 5 ? kept : ring;
  };
  const walk = (coords, depth) => (depth === 0 ? thinRing(coords) : coords.map((c) => walk(c, depth - 1)));
  if (geom.type === 'Polygon') return { ...geom, coordinates: walk(geom.coordinates, 1) };
  if (geom.type === 'MultiPolygon') return { ...geom, coordinates: walk(geom.coordinates, 2) };
  return geom;
}

/** Drop rings whose bbox is tiny (specks/islands) from Multi/Polygons. */
function dropTinyRings(geom, minDeg = 0.002) {
  const big = (ring) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return maxX - minX >= minDeg || maxY - minY >= minDeg;
  };
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates.filter((r, i) => i === 0 || big(r));
    return { ...geom, coordinates: rings };
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates
      .map((poly) => poly.filter((r, i) => i === 0 || big(r)))
      .filter((poly) => poly.length > 0 && big(poly[0]));
    return { ...geom, coordinates: polys.length ? polys : geom.coordinates.slice(0, 1) };
  }
  return geom;
}

/** Shrink a FeatureCollection until its serialised size fits the budget. */
function fitToBudget(fc, label) {
  for (const f of fc.features) {
    f.geometry = dropTinyRings(roundGeometry(f.geometry));
  }
  let json = JSON.stringify(fc);
  let passes = 0;
  while (json.length > MAX_BYTES && passes < 12) {
    for (const f of fc.features) f.geometry = decimateGeometry(f.geometry);
    json = JSON.stringify(fc);
    passes += 1;
  }
  log(`${label}: ${(json.length / 1024).toFixed(1)} KB after ${passes} decimation pass(es)`);
  if (json.length > MAX_BYTES) warn(`${label} still exceeds ${MAX_KB} KB budget`);
  return json;
}

/** Ray-casting point-in-polygon for GeoJSON Polygon/MultiPolygon. */
function pointInGeometry(lon, lat, geom) {
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  for (const poly of polys) {
    if (inRing(poly[0]) && !poly.slice(1).some(inRing)) return true;
  }
  return false;
}

/** Area-weighted centroid of the largest ring (good enough for labels/camera). */
function polygonCentroid(geom) {
  const rings =
    geom.type === 'Polygon'
      ? [geom.coordinates[0]]
      : geom.type === 'MultiPolygon'
        ? geom.coordinates.map((p) => p[0])
        : [];
  let best = null;
  let bestArea = -1;
  for (const ring of rings) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      const cross = x1 * y2 - x2 * y1;
      a += cross;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    a /= 2;
    const abs = Math.abs(a);
    if (abs > bestArea && abs > 0) {
      bestArea = abs;
      best = [cx / (6 * a), cy / (6 * a)];
    }
  }
  return best; // [lon, lat] or null
}

/* ------------------------------------------------------------------ */
/* reference tables (kenya-locations, MIT)                             */
/* ------------------------------------------------------------------ */

async function loadReference() {
  const [counties, constituencies, wards] = await Promise.all([
    readFile(path.join(REF_DIR, 'counties.json'), 'utf8').then(JSON.parse),
    readFile(path.join(REF_DIR, 'constituencies.json'), 'utf8').then(JSON.parse),
    readFile(path.join(REF_DIR, 'wards.json'), 'utf8').then(JSON.parse),
  ]);
  // Two-hop join: ward.constituency (a NAME) -> constituencies.json -> county name.
  const constByName = new Map(constituencies.map((c) => [normName(c.name), c]));
  const countyByName = new Map(counties.map((c) => [normName(c.name), c]));
  const wardsJoined = wards.map((w) => {
    const cst = constByName.get(normName(w.constituency));
    const cty = cst ? countyByName.get(normName(cst.county)) : undefined;
    return { ...w, constituencyCode: cst?.code ?? null, county: cst?.county ?? null, countyCode: cty?.code ?? null };
  });
  return { counties, constituencies, wards: wardsJoined, countyByName };
}

/* ------------------------------------------------------------------ */
/* ADM1 counties                                                       */
/* ------------------------------------------------------------------ */

async function buildCounties(ref) {
  const meta = await fetchJson(GEOBOUNDARIES_ADM1_API, 'geoBoundaries KEN ADM1 metadata');
  const url = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
  const fc = await fetchJson(url, 'KEN ADM1 GeoJSON');
  if (!fc?.features?.length) throw new Error('ADM1 GeoJSON empty');

  // Known naming drift between geoBoundaries and kenya-locations.
  const COUNTY_ALIASES = { tharaka: 'tharakanithi' };
  let misses = 0;
  for (const f of fc.features) {
    const gbName = f.properties.shapeName ?? f.properties.name;
    const key = normName(gbName);
    const match = ref.countyByName.get(COUNTY_ALIASES[key] ?? key);
    if (!match) {
      misses += 1;
      warn(`ADM1 name miss (no kenya-locations county): "${gbName}"`);
    }
    f.properties = {
      code: match?.code ?? null,
      name: match?.name ?? gbName,
      sourceName: gbName,
      shapeID: f.properties.shapeID ?? null,
      level: 'county',
      source: 'geoBoundaries gbOpen KEN ADM1 (RCMRD GeoPortal)',
      license: 'geoBoundaries gbOpen — underlying source Public Domain; cite geoBoundaries (CC BY 4.0 citation requested)',
      classification: 'official',
      approximate: false,
    };
  }
  log(`ADM1: ${fc.features.length} counties, ${misses} name miss(es)`);
  const json = fitToBudget(fc, 'counties.geojson');
  await writeFile(path.join(OUT_DIR, 'counties.geojson'), json);
  return JSON.parse(json);
}

/* ------------------------------------------------------------------ */
/* ADM3 Murang'a wards                                                 */
/* ------------------------------------------------------------------ */

async function buildWards(ref, countiesFc) {
  const murangaGeom = countiesFc?.features?.find((f) => f.properties.code === MURANGA_COUNTY_CODE)?.geometry;

  // 1. geoBoundaries ADM3 (has no parent-county property — filter SPATIALLY
  //    by testing each ward's centroid against the Murang'a ADM1 polygon).
  try {
    const meta = await fetchJson(GEOBOUNDARIES_ADM3_API, 'geoBoundaries KEN ADM3 metadata');
    if (meta && (meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL) && murangaGeom) {
      const fc = await fetchJson(meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL, 'KEN ADM3 GeoJSON');
      const muranga = fc.features.filter((f) => {
        const c = polygonCentroid(f.geometry);
        return c && pointInGeometry(c[0], c[1], murangaGeom);
      });
      log(`spatially filtered ${muranga.length} Murang'a ward candidates from ${fc.features.length} ADM3 features`);
      if (muranga.length >= 30 && muranga.length <= 45) {
        return finishWards(muranga, ref, {
          source: 'geoBoundaries gbOpen KEN ADM3 (IEBC-derived)',
          license: 'geoBoundaries gbOpen (CC BY 4.0 citation requested)',
          nameProp: 'shapeName',
        });
      }
      warn(`ADM3 spatial filter yielded ${muranga.length} wards (expected ~35) — falling back.`);
    } else {
      log('geoBoundaries KEN ADM3 not usable — falling back.');
    }
  } catch (e) {
    log(`geoBoundaries ADM3 probe failed (${e.message}) — falling back.`);
  }

  // 2. MIT GitHub all-Kenya IEBC ward GeoJSON (34 MB — filtered to Murang'a).
  //    (3. would be the HDX SHP: see HDX_WARDS_SHP_URL in the header.)
  const fc = await fetchJson(WARDS_GEOJSON_URL, 'IEBC wards GeoJSON (tigawanna/kenya_wards_geojson_data, MIT)');
  const muranga = fc.features.filter((f) => Number(f.properties.county_code) === 21);
  if (!muranga.length) throw new Error("no features with county_code 21 (Murang'a)");
  log(`filtered ${muranga.length} Murang'a ward features from ${fc.features.length}`);
  return finishWards(muranga, ref, {
    source: 'IEBC ward boundaries via tigawanna/kenya_wards_geojson_data (GitHub)',
    license: 'MIT (repository); boundaries originally published by IEBC',
    nameProp: 'ward_name',
  });
}

function finishWards(features, ref, { source, license, nameProp }) {
  const murangaRef = ref.wards.filter((w) => w.countyCode === MURANGA_COUNTY_CODE);
  const refByName = new Map(murangaRef.map((w) => [normName(w.name), w]));
  let misses = 0;
  for (const f of features) {
    const raw = f.properties[nameProp];
    const match = refByName.get(normName(raw));
    if (!match) {
      misses += 1;
      warn(`ward name miss (no kenya-locations entry in Murang'a): "${raw}"`);
    }
    f.properties = {
      code: match?.code ?? null,
      name: match?.name ?? raw,
      sourceName: raw,
      constituency: match?.constituency ?? f.properties.constituency_name ?? null,
      constituencyCode: match?.constituencyCode ?? null,
      county: MURANGA_COUNTY_NAME,
      countyCode: MURANGA_COUNTY_CODE,
      level: 'ward',
      source,
      license,
      classification: 'official',
      approximate: false,
    };
  }
  const kandara = features.filter((f) => normName(f.properties.constituency) === normName(KANDARA_CONSTITUENCY));
  log(`wards: ${features.length} in Murang'a (${kandara.length} in Kandara), ${misses} name miss(es)`);
  if (kandara.length !== 6) warn(`expected 6 Kandara wards, found ${kandara.length}`);
  return { type: 'FeatureCollection', features };
}

/* ------------------------------------------------------------------ */
/* centroids                                                           */
/* ------------------------------------------------------------------ */

async function writeCentroids(wardsFc, countiesFc) {
  const r5 = (n) => Math.round(n * 1e5) / 1e5;
  const wardEntries = [];
  for (const f of wardsFc.features) {
    if (normName(f.properties.constituency) !== normName(KANDARA_CONSTITUENCY)) continue;
    const c = polygonCentroid(f.geometry);
    if (!c) {
      warn(`no centroid computable for ward ${f.properties.name}`);
      continue;
    }
    wardEntries.push({
      code: f.properties.code,
      name: f.properties.name,
      constituency: f.properties.constituency,
      county: f.properties.county,
      lat: r5(c[1]),
      lon: r5(c[0]),
      derivation: f.properties.approximate ? 'simulated' : 'calculated',
    });
  }
  wardEntries.sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const countyEntries = [];
  const mur = countiesFc.features.find((f) => f.properties.code === MURANGA_COUNTY_CODE);
  if (mur) {
    const c = polygonCentroid(mur.geometry);
    if (c) {
      countyEntries.push({
        code: MURANGA_COUNTY_CODE,
        name: MURANGA_COUNTY_NAME,
        lat: r5(c[1]),
        lon: r5(c[0]),
        derivation: mur.properties.approximate ? 'simulated' : 'calculated',
      });
    }
  }
  const out = {
    generatedAt: new Date().toISOString(),
    note: 'Centroids of the largest polygon ring per area; for labels/camera only, not authoritative.',
    wards: wardEntries,
    counties: countyEntries,
  };
  await writeFile(path.join(OUT_DIR, 'centroids.json'), JSON.stringify(out, null, 2));
  log(`centroids.json: ${wardEntries.length} wards, ${countyEntries.length} counties`);
  return out;
}

/* ------------------------------------------------------------------ */
/* approximate fallbacks (only when download fails AND nothing exists) */
/* ------------------------------------------------------------------ */

const APPROX_WARD_CENTROIDS = [
  { code: '0539', name: "Ng'araria", lat: -0.83, lon: 37.0 },
  { code: '0540', name: 'Muruka', lat: -0.86, lon: 37.03 },
  { code: '0541', name: 'Kagundu-ini', lat: -0.89, lon: 36.94 },
  { code: '0542', name: 'Gaichanjiru', lat: -0.92, lon: 36.99 },
  { code: '0543', name: 'Ithiru', lat: -0.82, lon: 36.93 },
  { code: '0544', name: 'Ruchu', lat: -0.88, lon: 36.9 },
];

function hexagon(lat, lon, radiusDeg) {
  const ring = [];
  for (let i = 0; i <= 6; i += 1) {
    const a = (Math.PI / 3) * i;
    ring.push([+(lon + radiusDeg * Math.cos(a)).toFixed(5), +(lat + radiusDeg * Math.sin(a)).toFixed(5)]);
  }
  return [ring];
}

function approxWardsFc() {
  return {
    type: 'FeatureCollection',
    features: APPROX_WARD_CENTROIDS.map((w) => ({
      type: 'Feature',
      properties: {
        code: w.code,
        name: w.name,
        sourceName: w.name,
        constituency: KANDARA_CONSTITUENCY,
        constituencyCode: '109',
        county: MURANGA_COUNTY_NAME,
        countyCode: MURANGA_COUNTY_CODE,
        level: 'ward',
        source: 'Hand-authored approximate placeholder (network unavailable at build time)',
        license: 'CC0 — synthetic placeholder, NOT official boundaries',
        classification: 'simulated',
        approximate: true,
      },
      geometry: { type: 'Polygon', coordinates: hexagon(w.lat, w.lon, 0.013) },
    })),
  };
}

function approxCountiesFc() {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          code: MURANGA_COUNTY_CODE,
          name: MURANGA_COUNTY_NAME,
          sourceName: MURANGA_COUNTY_NAME,
          level: 'county',
          source: 'Hand-authored approximate placeholder (network unavailable at build time)',
          license: 'CC0 — synthetic placeholder, NOT official boundaries',
          classification: 'simulated',
          approximate: true,
        },
        geometry: { type: 'Polygon', coordinates: hexagon(-0.78, 37.05, 0.28) },
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* --supabase (log-only: schema owned by another workstream)           */
/* ------------------------------------------------------------------ */

function logSupabasePlan(wardsFc, countiesFc) {
  log('--supabase: logging the upserts that WOULD run (schema owned elsewhere):');
  const rows = [];
  for (const f of countiesFc.features) {
    rows.push({ level: 'county', code: f.properties.code, name: f.properties.name });
  }
  for (const f of wardsFc.features) {
    rows.push({ level: 'ward', code: f.properties.code, name: f.properties.name, parent: f.properties.countyCode });
  }
  for (const r of rows.slice(0, 8)) {
    console.log(
      `  INSERT INTO administrative_areas (level, code, name, parent_code, geometry, classification)\n` +
        `  VALUES ('${r.level}', '${r.code}', $name, ${r.parent ? `'${r.parent}'` : 'NULL'}, ST_GeomFromGeoJSON($geojson), 'official')\n` +
        `  ON CONFLICT (level, code) DO UPDATE SET name = EXCLUDED.name, geometry = EXCLUDED.geometry;`,
    );
  }
  log(`  ... ${rows.length} rows total. Execute via supabase-js:`);
  log(`  const { error } = await supabase.from('administrative_areas').upsert(rows, { onConflict: 'level,code' })`);
  log('  (Requires SUPABASE_SECRET_KEY in services/api env — never in the browser.)');
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const ref = await loadReference();

  const countiesPath = path.join(OUT_DIR, 'counties.geojson');
  const wardsPath = path.join(OUT_DIR, 'muranga_wards.geojson');

  let countiesFc = null;
  let wardsFc = null;

  if (OFFLINE) {
    log('--offline: skipping downloads, keeping committed files.');
    if (await exists(countiesPath)) countiesFc = JSON.parse(await readFile(countiesPath, 'utf8'));
    if (await exists(wardsPath)) wardsFc = JSON.parse(await readFile(wardsPath, 'utf8'));
  } else {
    try {
      countiesFc = await buildCounties(ref);
    } catch (e) {
      warn(`county download failed: ${e.message}`);
      if (await exists(countiesPath)) {
        log('keeping existing committed counties.geojson');
        countiesFc = JSON.parse(await readFile(countiesPath, 'utf8'));
      } else {
        warn('no committed counties.geojson — writing APPROXIMATE fallback (classification: simulated)');
        countiesFc = approxCountiesFc();
        await writeFile(countiesPath, JSON.stringify(countiesFc));
      }
    }
    try {
      wardsFc = await buildWards(ref, countiesFc);
      const json = fitToBudget(wardsFc, 'muranga_wards.geojson');
      await writeFile(wardsPath, json);
      wardsFc = JSON.parse(json);
    } catch (e) {
      warn(`ward download failed: ${e.message}`);
      if (await exists(wardsPath)) {
        log('keeping existing committed muranga_wards.geojson');
        wardsFc = JSON.parse(await readFile(wardsPath, 'utf8'));
      } else {
        warn('no committed muranga_wards.geojson — writing APPROXIMATE fallback (classification: simulated)');
        wardsFc = approxWardsFc();
        await writeFile(wardsPath, JSON.stringify(wardsFc));
      }
    }
  }

  if (wardsFc && countiesFc) {
    await writeCentroids(wardsFc, countiesFc);
  } else {
    warn('missing geometry — centroids.json not regenerated (committed file, if any, left intact).');
  }

  if (SUPABASE && wardsFc && countiesFc) logSupabasePlan(wardsFc, countiesFc);

  log('done.');
}

main().catch((e) => {
  // NEVER fail the build: warn loudly, exit 0, leave committed files intact.
  warn(`pipeline error (non-fatal): ${e.stack || e.message}`);
  process.exit(0);
});
