/**
 * Bundled offline Kilimo dataset — GENERATED FILE, do not hand-edit the data.
 *
 * Source of truth: ./kilimo-fallback.json (human-editable).
 * Regenerate after editing the JSON:
 *   node packages/shared/src/data/generate-index.mjs
 * A vitest consistency test (./data-consistency.test.ts) fails if this file
 * and the JSON drift apart, or if the data drifts from the engine fixtures.
 *
 * Why a .ts literal instead of a JSON import: packages/shared compiles with
 * module NodeNext and no resolveJsonModule; embedding the literal keeps the
 * package importable from Node (services/api) and Vite (apps/globe) alike
 * with zero loader configuration.
 *
 * Shapes: programme/prices/depots/farmers are SUPERSETS of the eligibility
 * engine's input types (../eligibility/types.ts) — every record can be passed
 * straight into evaluateFarmer. The extra fields (town, classification,
 * per-record evidence, ...) exist for map rendering and citation display.
 */

import type {
  Depot,
  EvidenceTag,
  FarmerToken,
  PriceRow,
  ProgrammeRules,
} from '../eligibility/types.js';

/* ------------------------------------------------------------------ */
/* Data-layer types (supersets of the engine input types)              */
/* ------------------------------------------------------------------ */

/** Engine ProgrammeRules plus provenance/display extras. */
export interface FallbackProgramme extends ProgrammeRules {
  authority: 'official' | 'reported';
  source: string;
  effectiveFrom: string;
  /** kenya-locations ward codes matching participatingWards (names) 1:1. */
  participatingWardCodes: string[];
}

/** Engine Depot plus display extras. */
export interface FallbackDepot extends Depot {
  town: string;
  county: string;
}

/** Engine FarmerToken plus provenance extras. */
export interface FallbackFarmer extends FarmerToken {
  classification: 'simulated';
  evidence: EvidenceTag;
}

/** Kandara ward with kenya-locations codes and a calculated centroid. */
export interface WardRecord {
  code: string;
  name: string;
  constituency: string;
  constituencyCode: string;
  county: string;
  countyCode: string;
  lat: number;
  lon: number;
  participating: boolean;
  evidence: EvidenceTag;
}

/** A declared data source; every EvidenceTag.sourceId resolves here. */
export interface SourceRecord {
  id: string;
  name: string;
  publisher: string;
  authority: 'official' | 'reported';
  effectiveDate: string | null;
  url: string | null;
  license: string;
  notes: string;
}

/** The single bundled snapshot read when Supabase is unavailable. */
export interface KilimoFallback {
  dataMode: 'bundled';
  generatedAt: string;
  programme: FallbackProgramme;
  prices: PriceRow[];
  depots: FallbackDepot[];
  farmers: FallbackFarmer[];
  wards: WardRecord[];
  sources: SourceRecord[];
}

/* ------------------------------------------------------------------ */
/* Data (generated from kilimo-fallback.json)                          */
/* ------------------------------------------------------------------ */

export const KILIMO_FALLBACK: KilimoFallback = {
  "dataMode": "bundled",
  "generatedAt": "2026-09-02T00:00:00Z",
  "programme": {
    "id": "ken-fert-subsidy-2026",
    "name": "National Fertilizer Subsidy Programme",
    "season": "2026 Long Rains",
    "authority": "official",
    "source": "MoALD subsidy circular",
    "effectiveFrom": "2026-08-14",
    "participatingWards": [
      "Ng'araria",
      "Muruka",
      "Kagundu-ini",
      "Gaichanjiru",
      "Ithiru",
      "Ruchu"
    ],
    "participatingWardCodes": [
      "0539",
      "0540",
      "0541",
      "0542",
      "0543",
      "0544"
    ],
    "criteria": [
      {
        "id": "in_register",
        "label": "Appears in the Kenya Farmer Register",
        "test": "in_register",
        "evidence": {
          "authority": "official",
          "derivation": "direct",
          "freshness": {
            "checkedAt": "2026-08-14T00:00:00Z",
            "status": "current"
          },
          "sourceId": "moald-subsidy-circular-2026",
          "citation": "MoALD subsidy circular — National Fertilizer Subsidy Programme, 2026 Long Rains, effective 2026-08-14 — registration requirement (sec. 2a)"
        }
      },
      {
        "id": "id_linked",
        "label": "National ID linked to register entry",
        "test": "id_linked",
        "evidence": {
          "authority": "official",
          "derivation": "direct",
          "freshness": {
            "checkedAt": "2026-08-14T00:00:00Z",
            "status": "current"
          },
          "sourceId": "moald-subsidy-circular-2026",
          "citation": "MoALD subsidy circular — National Fertilizer Subsidy Programme, 2026 Long Rains, effective 2026-08-14 — ID-linkage requirement (sec. 2b)"
        }
      },
      {
        "id": "acreage_max",
        "label": "Farm size within the 5-acre cap",
        "test": "acreage_max",
        "param": 5,
        "evidence": {
          "authority": "official",
          "derivation": "direct",
          "freshness": {
            "checkedAt": "2026-08-14T00:00:00Z",
            "status": "current"
          },
          "sourceId": "moald-subsidy-circular-2026",
          "citation": "MoALD subsidy circular — National Fertilizer Subsidy Programme, 2026 Long Rains, effective 2026-08-14 — smallholder acreage cap (sec. 2c)"
        }
      },
      {
        "id": "ward_participating",
        "label": "Ward is on the participating list",
        "test": "ward_participating",
        "evidence": {
          "authority": "official",
          "derivation": "direct",
          "freshness": {
            "checkedAt": "2026-08-14T00:00:00Z",
            "status": "current"
          },
          "sourceId": "moald-subsidy-circular-2026",
          "citation": "MoALD subsidy circular — National Fertilizer Subsidy Programme, 2026 Long Rains, effective 2026-08-14 — participating wards annex"
        }
      },
      {
        "id": "stock_available",
        "label": "Stock available at the assigned depot",
        "test": "stock_available",
        "evidence": {
          "authority": "official",
          "derivation": "direct",
          "freshness": {
            "checkedAt": "2026-08-14T00:00:00Z",
            "status": "current"
          },
          "sourceId": "moald-subsidy-circular-2026",
          "citation": "MoALD subsidy circular — National Fertilizer Subsidy Programme, 2026 Long Rains, effective 2026-08-14 — redemption subject to depot stock (sec. 4)"
        }
      }
    ],
    "allocationFormula": {
      "bagsPerAcre": 2,
      "maxBags": 10
    },
    "evidence": {
      "authority": "official",
      "derivation": "direct",
      "freshness": {
        "checkedAt": "2026-08-14T00:00:00Z",
        "status": "current"
      },
      "sourceId": "moald-subsidy-circular-2026",
      "citation": "MoALD subsidy circular — National Fertilizer Subsidy Programme, 2026 Long Rains, effective 2026-08-14"
    },
    "wardCentroids": {
      "Ng'araria": {
        "wardCode": "0539",
        "lat": -0.93588,
        "lon": 37.02661
      },
      "Muruka": {
        "wardCode": "0540",
        "lat": -0.92609,
        "lon": 37.05547
      },
      "Kagundu-ini": {
        "wardCode": "0541",
        "lat": -0.90542,
        "lon": 37.0706
      },
      "Gaichanjiru": {
        "wardCode": "0542",
        "lat": -0.87136,
        "lon": 37.04936
      },
      "Ithiru": {
        "wardCode": "0543",
        "lat": -0.88043,
        "lon": 36.98795
      },
      "Ruchu": {
        "wardCode": "0544",
        "lat": -0.83148,
        "lon": 36.92132
      }
    }
  },
  "prices": [
    {
      "inputType": "planting_fertilizer",
      "subsidizedPriceKes": 2500,
      "marketPriceKes": 6500,
      "bagWeightKg": 50,
      "validFrom": "2026-08-14T00:00:00Z",
      "validTo": "2026-12-31T23:59:59Z",
      "evidence": {
        "authority": "official",
        "derivation": "direct",
        "freshness": {
          "checkedAt": "2026-08-14T00:00:00Z",
          "status": "current"
        },
        "sourceId": "kenya-gazette-price-notice-2026",
        "citation": "Kenya Gazette price notice — subsidized planting fertilizer, KES 2,500 per 50 kg bag (market ~KES 6,500), valid 2026-08-14 to 2026-12-31"
      }
    }
  ],
  "depots": [
    {
      "id": "ncpb-sagana",
      "name": "NCPB Sagana Depot",
      "lat": -0.66,
      "lon": 37.2,
      "merchant": "National Cereals and Produce Board",
      "assetType": "ncpb_depot",
      "town": "Sagana",
      "county": "Kirinyaga",
      "stockStatus": "in_stock",
      "checkedAt": "2026-09-02T06:00:00Z",
      "classification": "official",
      "evidence": {
        "authority": "official",
        "derivation": "direct",
        "freshness": {
          "checkedAt": "2026-09-02T06:00:00Z",
          "status": "current"
        },
        "sourceId": "ncpb-depot-register",
        "citation": "NCPB depot register — Sagana Depot stock report, checked 2026-09-02 06:00 UTC"
      }
    },
    {
      "id": "kabati-agrovet",
      "name": "Kabati Agrovet",
      "lat": -0.9,
      "lon": 36.98,
      "merchant": "Kabati Agrovet Ltd (SIMULATED)",
      "assetType": "agro_dealer",
      "town": "Kabati",
      "county": "Murang'a",
      "stockStatus": "unknown",
      "checkedAt": null,
      "classification": "simulated",
      "evidence": {
        "authority": "reported",
        "derivation": "simulated",
        "freshness": {
          "checkedAt": null,
          "status": "unknown"
        },
        "sourceId": "simulated-depot-kabati",
        "citation": "SIMULATED agro-dealer for demo — Kabati Agrovet; no verified stock feed"
      }
    },
    {
      "id": "kagunduini-supplies",
      "name": "Kagundu-ini Farm Supplies",
      "lat": -0.93,
      "lon": 36.94,
      "merchant": "Kagundu-ini Farm Supplies (SIMULATED)",
      "assetType": "agro_dealer",
      "town": "Kagundu-ini",
      "county": "Murang'a",
      "stockStatus": "low",
      "checkedAt": "2026-09-01T14:00:00Z",
      "classification": "simulated",
      "evidence": {
        "authority": "reported",
        "derivation": "simulated",
        "freshness": {
          "checkedAt": "2026-09-01T14:00:00Z",
          "status": "current"
        },
        "sourceId": "simulated-depot-kagunduini",
        "citation": "SIMULATED agro-dealer for demo — Kagundu-ini Farm Supplies; stock self-reported 2026-09-01 14:00 UTC"
      }
    },
    {
      "id": "kenol-agro",
      "name": "Kenol Agro Centre",
      "lat": -0.99,
      "lon": 37.12,
      "merchant": "Kenol Agro Centre (SIMULATED)",
      "assetType": "agro_dealer",
      "town": "Kenol",
      "county": "Murang'a",
      "stockStatus": "in_stock",
      "checkedAt": "2026-09-02T05:30:00Z",
      "classification": "simulated",
      "evidence": {
        "authority": "reported",
        "derivation": "simulated",
        "freshness": {
          "checkedAt": "2026-09-02T05:30:00Z",
          "status": "current"
        },
        "sourceId": "simulated-depot-kenol",
        "citation": "SIMULATED agro-dealer for demo — Kenol Agro Centre; stock self-reported 2026-09-02 05:30 UTC"
      }
    }
  ],
  "farmers": [
    {
      "token": "K-001",
      "wardCode": "0539",
      "wardName": "Ng'araria",
      "state": "registered",
      "assignedDepotId": "ncpb-sagana",
      "classification": "simulated",
      "attributes": {
        "inFarmerRegister": true,
        "nationalIdLinked": true,
        "acreage": 2,
        "crop": "maize",
        "priorRedemptions": 0
      },
      "evidence": {
        "authority": "reported",
        "derivation": "simulated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "simulated-farmer-tokens",
        "citation": "SIMULATED farmer token K-001 (demo seed) — fully registered smallholder in Ng'araria ward; expected outcome 'confirmed', 4 bags"
      }
    },
    {
      "token": "K-002",
      "wardCode": "0540",
      "wardName": "Muruka",
      "state": "missing_requirement",
      "assignedDepotId": "kabati-agrovet",
      "classification": "simulated",
      "attributes": {
        "inFarmerRegister": true,
        "nationalIdLinked": false,
        "acreage": 1.5,
        "crop": "maize",
        "priorRedemptions": 0
      },
      "evidence": {
        "authority": "reported",
        "derivation": "simulated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "simulated-farmer-tokens",
        "citation": "SIMULATED farmer token K-002 (demo seed) — registered in Muruka ward but national ID not linked; expected outcome eligible=false with next action at the ward agricultural office"
      }
    },
    {
      "token": "K-003",
      "wardCode": "0542",
      "wardName": "Gaichanjiru",
      "state": "ineligible",
      "assignedDepotId": "kabati-agrovet",
      "classification": "simulated",
      "attributes": {
        "inFarmerRegister": true,
        "nationalIdLinked": true,
        "acreage": 7.5,
        "crop": "maize",
        "priorRedemptions": 0
      },
      "evidence": {
        "authority": "reported",
        "derivation": "simulated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "simulated-farmer-tokens",
        "citation": "SIMULATED farmer token K-003 (demo seed) — registered in Gaichanjiru ward but 7.5 acres exceeds the 5-acre cap; expected outcome eligible=false (confirmed negative)"
      }
    },
    {
      "token": "K-004",
      "wardCode": "0543",
      "wardName": "Ithiru",
      "state": "registered",
      "assignedDepotId": "kabati-agrovet",
      "classification": "simulated",
      "attributes": {
        "inFarmerRegister": true,
        "nationalIdLinked": true,
        "acreage": 3,
        "crop": "maize",
        "priorRedemptions": 0
      },
      "evidence": {
        "authority": "reported",
        "derivation": "simulated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "simulated-farmer-tokens",
        "citation": "SIMULATED farmer token K-004 (demo seed) — fully registered in Ithiru ward but assigned to the unknown-stock Kabati Agrovet; the deliberate 'sijui' case, expected outcome 'indicated_by_published_rules'"
      }
    },
    {
      "token": "K-005",
      "wardCode": "0544",
      "wardName": "Ruchu",
      "state": "unknown",
      "assignedDepotId": "kenol-agro",
      "classification": "simulated",
      "attributes": {
        "inFarmerRegister": "unknown",
        "nationalIdLinked": true,
        "acreage": 2.5,
        "crop": "maize",
        "priorRedemptions": 0
      },
      "evidence": {
        "authority": "reported",
        "derivation": "simulated",
        "freshness": {
          "checkedAt": null,
          "status": "unknown"
        },
        "sourceId": "simulated-farmer-tokens",
        "citation": "SIMULATED farmer token K-005 (demo seed) — register status itself unverifiable (inFarmerRegister = 'unknown'); expected outcome 'cannot_determine'"
      }
    }
  ],
  "wards": [
    {
      "code": "0539",
      "name": "Ng'araria",
      "constituency": "Kandara",
      "constituencyCode": "109",
      "county": "Murang'a",
      "countyCode": "021",
      "lat": -0.93588,
      "lon": 37.02661,
      "participating": true,
      "evidence": {
        "authority": "official",
        "derivation": "calculated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "geoboundaries-ken-adm3",
        "citation": "Ward code/name from kenya-locations (MIT); centroid calculated from geoBoundaries gbOpen KEN ADM3 geometry"
      }
    },
    {
      "code": "0540",
      "name": "Muruka",
      "constituency": "Kandara",
      "constituencyCode": "109",
      "county": "Murang'a",
      "countyCode": "021",
      "lat": -0.92609,
      "lon": 37.05547,
      "participating": true,
      "evidence": {
        "authority": "official",
        "derivation": "calculated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "geoboundaries-ken-adm3",
        "citation": "Ward code/name from kenya-locations (MIT); centroid calculated from geoBoundaries gbOpen KEN ADM3 geometry"
      }
    },
    {
      "code": "0541",
      "name": "Kagundu-ini",
      "constituency": "Kandara",
      "constituencyCode": "109",
      "county": "Murang'a",
      "countyCode": "021",
      "lat": -0.90542,
      "lon": 37.0706,
      "participating": true,
      "evidence": {
        "authority": "official",
        "derivation": "calculated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "geoboundaries-ken-adm3",
        "citation": "Ward code/name from kenya-locations (MIT); centroid calculated from geoBoundaries gbOpen KEN ADM3 geometry"
      }
    },
    {
      "code": "0542",
      "name": "Gaichanjiru",
      "constituency": "Kandara",
      "constituencyCode": "109",
      "county": "Murang'a",
      "countyCode": "021",
      "lat": -0.87136,
      "lon": 37.04936,
      "participating": true,
      "evidence": {
        "authority": "official",
        "derivation": "calculated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "geoboundaries-ken-adm3",
        "citation": "Ward code/name from kenya-locations (MIT); centroid calculated from geoBoundaries gbOpen KEN ADM3 geometry"
      }
    },
    {
      "code": "0543",
      "name": "Ithiru",
      "constituency": "Kandara",
      "constituencyCode": "109",
      "county": "Murang'a",
      "countyCode": "021",
      "lat": -0.88043,
      "lon": 36.98795,
      "participating": true,
      "evidence": {
        "authority": "official",
        "derivation": "calculated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "geoboundaries-ken-adm3",
        "citation": "Ward code/name from kenya-locations (MIT); centroid calculated from geoBoundaries gbOpen KEN ADM3 geometry"
      }
    },
    {
      "code": "0544",
      "name": "Ruchu",
      "constituency": "Kandara",
      "constituencyCode": "109",
      "county": "Murang'a",
      "countyCode": "021",
      "lat": -0.83148,
      "lon": 36.92132,
      "participating": true,
      "evidence": {
        "authority": "official",
        "derivation": "calculated",
        "freshness": {
          "checkedAt": "2026-09-02T00:00:00Z",
          "status": "current"
        },
        "sourceId": "geoboundaries-ken-adm3",
        "citation": "Ward code/name from kenya-locations (MIT); centroid calculated from geoBoundaries gbOpen KEN ADM3 geometry"
      }
    }
  ],
  "sources": [
    {
      "id": "moald-subsidy-circular-2026",
      "name": "MoALD subsidy circular",
      "publisher": "Ministry of Agriculture and Livestock Development (Kenya)",
      "authority": "official",
      "effectiveDate": "2026-08-14",
      "url": null,
      "license": "Official government circular (cited)",
      "notes": "Programme rules and eligibility criteria for the National Fertilizer Subsidy Programme, 2026 Long Rains season. Canonical demo rule set."
    },
    {
      "id": "kenya-gazette-price-notice-2026",
      "name": "Kenya Gazette price notice",
      "publisher": "Government of Kenya",
      "authority": "official",
      "effectiveDate": "2026-08-14",
      "url": null,
      "license": "Official gazette notice (cited)",
      "notes": "Subsidized (KES 2,500) and market reference (KES 6,500) prices per 50 kg bag, valid 2026-08-14 to 2026-12-31."
    },
    {
      "id": "ncpb-depot-register",
      "name": "NCPB depot network listing",
      "publisher": "National Cereals and Produce Board",
      "authority": "official",
      "effectiveDate": null,
      "url": "https://ncpb.co.ke",
      "license": "Official public listing (cited)",
      "notes": "Sagana Depot is a real NCPB facility on the published depot network; its demo stock status is an operational reading tagged with its own checkedAt timestamp."
    },
    {
      "id": "simulated-depot-kabati",
      "name": "Kabati Agrovet (synthetic)",
      "publisher": "TerraMavuno demo team",
      "authority": "reported",
      "effectiveDate": "2026-09-02",
      "url": null,
      "license": "CC0 — synthetic demo data",
      "notes": "SIMULATED agro-dealer placed at Kabati town, Kandara. Stock never checked — the deliberate 'sijui' depot."
    },
    {
      "id": "simulated-depot-kagunduini",
      "name": "Kagundu-ini Farm Supplies (synthetic)",
      "publisher": "TerraMavuno demo team",
      "authority": "reported",
      "effectiveDate": "2026-09-02",
      "url": null,
      "license": "CC0 — synthetic demo data",
      "notes": "SIMULATED agro-dealer placed at Kagundu-ini market, Kandara. Stock is a demo value self-reported 2026-09-01 14:00 UTC."
    },
    {
      "id": "simulated-depot-kenol",
      "name": "Kenol Agro Centre (synthetic)",
      "publisher": "TerraMavuno demo team",
      "authority": "reported",
      "effectiveDate": "2026-09-02",
      "url": null,
      "license": "CC0 — synthetic demo data",
      "notes": "SIMULATED agro-dealer placed at Kenol town, Maragwa/Kandara border. Stock is a demo value self-reported 2026-09-02 05:30 UTC."
    },
    {
      "id": "simulated-farmer-tokens",
      "name": "TerraMavuno synthetic farmer tokens",
      "publisher": "TerraMavuno demo team",
      "authority": "reported",
      "effectiveDate": "2026-09-02",
      "url": null,
      "license": "CC0 — synthetic demo data",
      "notes": "SIMULATED: tokens K-001..K-005 contain no real personal data; each token exercises one engine state."
    },
    {
      "id": "kenya-locations-dataset",
      "name": "kenya-locations reference dataset",
      "publisher": "David Amunga (kenya-locations, GitHub)",
      "authority": "reported",
      "effectiveDate": null,
      "url": "https://github.com/DavidAmunga/kenya-locations",
      "license": "MIT",
      "notes": "Canonical county/constituency/ward names and codes (Murang'a 021, Kandara 109, wards 0539-0544). Vendored under references/kenya-locations."
    },
    {
      "id": "geoboundaries-ken-adm1",
      "name": "geoBoundaries gbOpen KEN ADM1 (counties)",
      "publisher": "geoBoundaries / RCMRD GeoPortal",
      "authority": "official",
      "effectiveDate": "2020-01-01",
      "url": "https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/",
      "license": "Underlying source Public Domain; geoBoundaries requests CC BY 4.0-style citation",
      "notes": "County boundary polygons, simplified for the globe. Retrieved 2026-09-02."
    },
    {
      "id": "geoboundaries-ken-adm3",
      "name": "geoBoundaries gbOpen KEN ADM3 (wards)",
      "publisher": "geoBoundaries / IEBC-derived",
      "authority": "official",
      "effectiveDate": "2020-01-01",
      "url": "https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM3/",
      "license": "geoBoundaries gbOpen — CC BY 4.0-style citation requested",
      "notes": "Ward boundary polygons, spatially filtered to Murang'a and joined to kenya-locations codes. Retrieved 2026-09-02."
    }
  ]
};

/* ------------------------------------------------------------------ */
/* Convenience views + lookups                                          */
/* ------------------------------------------------------------------ */

export const KILIMO_PROGRAMME: FallbackProgramme = KILIMO_FALLBACK.programme;
export const KILIMO_PRICES: PriceRow[] = KILIMO_FALLBACK.prices;
export const KILIMO_DEPOTS: FallbackDepot[] = KILIMO_FALLBACK.depots;
export const KILIMO_FARMERS: FallbackFarmer[] = KILIMO_FALLBACK.farmers;
export const KILIMO_WARDS: WardRecord[] = KILIMO_FALLBACK.wards;
export const KILIMO_SOURCES: SourceRecord[] = KILIMO_FALLBACK.sources;

/** The six Kandara constituency wards (kenya-locations codes 0539-0544). */
export const KANDARA_WARD_CODES: string[] = KILIMO_FALLBACK.programme.participatingWardCodes;

export function getFarmerByToken(token: string): FallbackFarmer | undefined {
  const t = token.trim().toUpperCase();
  return KILIMO_FALLBACK.farmers.find((f) => f.token.toUpperCase() === t);
}

export function getDepotById(id: string): FallbackDepot | undefined {
  return KILIMO_FALLBACK.depots.find((d) => d.id === id);
}

export function getWardByCode(codeOrName: string): WardRecord | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/[’'`´\-\s]/g, '');
  return KILIMO_FALLBACK.wards.find(
    (w) => w.code === codeOrName || norm(w.name) === norm(codeOrName),
  );
}

export function getSourceById(id: string): SourceRecord | undefined {
  return KILIMO_FALLBACK.sources.find((s) => s.id === id);
}
