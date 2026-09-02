/**
 * @module data/kilimo/wardLayer
 * @description Layer 'wards' — the Murang'a county outline plus the six
 * participating Kandara ward polygons, in the God's Eye View visual language:
 * a barely-there glass fill, a cased accent outline, and ward-name cards
 * published through the world overlay so the label arbiter de-clutters them on
 * zoom instead of letting six labels pile on one hillside.
 *
 * TRUTH MODEL: ward geometry is official (geoBoundaries/IEBC-derived), but a
 * feature flagged `properties.approximate` is NOT presented as official — its
 * card carries the "approximate boundary" evidence chip (reported · inferred ·
 * unverified) and its outline is drawn dashed-dim rather than accent-bright.
 *
 * Events dispatched on `window`:
 *   `kilimo:ward-selected` → `{ detail: { wardCode, wardName, constituency,
 *      county, approximate, lat, lon } }` (detail is null when the selection
 *      is cleared).
 */

import * as Cesium from 'cesium';
import {
  APPROXIMATE_GEOMETRY_EVIDENCE,
  CENTROID_EVIDENCE,
  CONSTITUENCY_NAME,
  COUNTY_CENTROID,
  COUNTY_GEOMETRY_EVIDENCE,
  COUNTY_NAME,
  PROGRAMME,
  WARD_CENTROIDS,
  WARD_GEOMETRY_EVIDENCE,
  loadCountyFeature,
  loadWardFeatures,
  wardCentroidByName,
} from './kilimoData.js';
import {
  TRUTH_COLORS,
  evidenceChipText,
  setEvidenceDecoration,
} from './evidenceBadges.js';
import { defineKilimoLayer, installKilimoPickHandler, kilimoEntryDefaults } from './layerKit.js';

/**
 * Boundary line weights.
 *
 * A single thin glowing polyline disappears against satellite imagery: the glow
 * spreads the colour out and the 2.5px core is lost in the terrain texture. So
 * every boundary is drawn TWICE — a dark casing underneath, then a crisp opaque
 * core on top. That is the standard cartographic trick for line work over
 * photography, and it is what makes the wards readable at county zoom.
 */
const LINE = {
  wardCore: 4.5,
  wardCasing: 8.5,
  wardCoreSelected: 7,
  wardCasingSelected: 12,
  countyCore: 3.5,
  countyCasing: 7,
};

/** Casing colour — near-black, semi-opaque, so the core reads on any basemap. */
const CASING_COLOR = Cesium.Color.fromCssColorString('#04070d').withAlpha(0.62);

/** Marks an entity as a casing so selection restyling never recolours it. */
const CASING_FLAG = '__kilimoCasing';

/** Entity-id prefix — also the pick-ownership key for this layer. */
export const WARD_ENTITY_PREFIX = 'kilimo-ward:';
/** CustomEvent name fired when a ward is clicked (or the selection cleared). */
export const WARD_SELECTED_EVENT = 'kilimo:ward-selected';

const ACCENT = TRUTH_COLORS.official;
const APPROXIMATE_ACCENT = TRUTH_COLORS.stale;

/**
 * Convert a GeoJSON Polygon/MultiPolygon into Cesium polygon hierarchies.
 * @param {object} geometry GeoJSON geometry.
 * @returns {Cesium.PolygonHierarchy[]} One hierarchy per polygon.
 */
export function polygonHierarchies(geometry) {
  const type = geometry?.type;
  const polygons = type === 'Polygon'
    ? [geometry.coordinates]
    : (type === 'MultiPolygon' ? geometry.coordinates : []);
  const hierarchies = [];
  for (const rings of polygons) {
    if (!Array.isArray(rings) || !Array.isArray(rings[0])) continue;
    const outer = Cesium.Cartesian3.fromDegreesArray(rings[0].flat());
    const holes = rings.slice(1)
      .filter((ring) => Array.isArray(ring) && ring.length > 2)
      .map((ring) => new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring.flat())));
    hierarchies.push(new Cesium.PolygonHierarchy(outer, holes));
  }
  return hierarchies;
}

/**
 * Outline positions (closed rings) for a GeoJSON geometry.
 * @param {object} geometry GeoJSON geometry.
 * @returns {Cesium.Cartesian3[][]} One position array per ring.
 */
export function outlineRings(geometry) {
  const type = geometry?.type;
  const polygons = type === 'Polygon'
    ? [geometry.coordinates]
    : (type === 'MultiPolygon' ? geometry.coordinates : []);
  const rings = [];
  for (const polygon of polygons) {
    for (const ring of Array.isArray(polygon) ? polygon : []) {
      if (!Array.isArray(ring) || ring.length < 3) continue;
      const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring
        : [...ring, ring[0]];
      rings.push(Cesium.Cartesian3.fromDegreesArray(closed.flat()));
    }
  }
  return rings;
}

/**
 * Build the 'wards' layer.
 * @param {object} ctx Layer context from registerKilimoLayers.
 * @returns {object} Dual-contract layer object.
 */
export function createWardLayer(ctx) {
  /** @type {Cesium.CustomDataSource|null} */
  let dataSource = null;
  /** @type {{destroy:function():void}|null} */
  let pickHandle = null;
  /** @type {object[]} Kandara ward features currently drawn. */
  let wardFeatures = [];
  /** @type {string} Ward code of the selected ward ('' when none). */
  let selectedWardCode = '';
  /** @type {object|null} Live overlay publisher, held for re-publish on select. */
  let overlayPublisher = null;

  /**
   * Card copy for one ward.
   * @param {object} properties Feature properties.
   * @param {object} centroid Ward centroid record.
   * @returns {string[]} Detail lines.
   */
  const wardDetails = (properties, centroid) => {
    const approximate = properties.approximate === true;
    const participating = PROGRAMME.participatingWards.includes(properties.name);
    const lines = [
      `${properties.constituency} constituency · ${properties.county} county`,
      participating
        ? `Participating ward · ${PROGRAMME.season}`
        : 'Not on the participating list',
      evidenceChipText(approximate ? APPROXIMATE_GEOMETRY_EVIDENCE : WARD_GEOMETRY_EVIDENCE),
    ];
    if (approximate) lines.push('APPROXIMATE BOUNDARY — not an official gazetted line');
    if (centroid) lines.push(evidenceChipText(CENTROID_EVIDENCE));
    return lines;
  };

  /**
   * Publish the ward-name cards through the world overlay so the label arbiter
   * owns de-cluttering. Called on enable and on every selection change.
   * @returns {void}
   */
  const publishEntries = () => {
    if (!overlayPublisher) return;
    const entries = [];
    for (const feature of wardFeatures) {
      const properties = feature.properties || {};
      const centroid = wardCentroidByName(properties.name)
        || { lat: properties.lat, lon: properties.lon };
      if (!Number.isFinite(Number(centroid?.lat)) || !Number.isFinite(Number(centroid?.lon))) continue;
      const approximate = properties.approximate === true;
      const selected = properties.code === selectedWardCode;
      const entryId = `ward-${properties.code}`;
      entries.push(kilimoEntryDefaults({
        id: entryId,
        source: 'kilimo-wards',
        position: Cesium.Cartesian3.fromDegrees(Number(centroid.lon), Number(centroid.lat), 0),
        variant: selected ? 'selected' : 'card',
        selected,
        title: properties.name,
        details: wardDetails(properties, centroid),
        accent: approximate ? APPROXIMATE_ACCENT : ACCENT,
        // Participating wards outrank the rest, so when the arbiter has to drop
        // a label it drops one the demo does not talk about.
        priority: (PROGRAMME.participatingWards.includes(properties.name) ? 100 : 40)
          + (selected ? 500 : 0),
        interactive: true,
        accessibilityLabel: `${properties.name} ward`,
        activate: () => {
          selectWard(properties.code);
          return true;
        },
      }));

      setEvidenceDecoration('kilimo-wards', entryId, {
        tags: [
          approximate ? APPROXIMATE_GEOMETRY_EVIDENCE : WARD_GEOMETRY_EVIDENCE,
          CENTROID_EVIDENCE,
        ],
        simulated: false,
      });
    }

    // The county name, anchored on the county centroid.
    entries.push(kilimoEntryDefaults({
      id: 'county-021',
      source: 'kilimo-wards',
      position: Cesium.Cartesian3.fromDegrees(COUNTY_CENTROID.lon, COUNTY_CENTROID.lat, 0),
      variant: 'card',
      title: `${COUNTY_NAME} county`,
      details: [
        `${CONSTITUENCY_NAME} constituency · ${PROGRAMME.participatingWards.length} participating wards`,
        evidenceChipText(COUNTY_GEOMETRY_EVIDENCE),
      ],
      accent: ACCENT,
      priority: 220,
      minAltitude: 0,
    }));
    setEvidenceDecoration('kilimo-wards', 'county-021', {
      tags: [COUNTY_GEOMETRY_EVIDENCE],
      simulated: false,
    });

    overlayPublisher.publish(entries);
  };

  /**
   * Select a ward by code, restyle its polygon, and announce it.
   * @param {string} wardCode Ward code, or '' to clear.
   * @returns {void}
   */
  const selectWard = (wardCode) => {
    if (selectedWardCode === wardCode) return;
    selectedWardCode = wardCode || '';
    applySelectionStyling();
    publishEntries();
    const feature = wardFeatures.find((f) => f.properties?.code === selectedWardCode);
    const centroid = feature ? wardCentroidByName(feature.properties.name) : null;
    window.dispatchEvent(new CustomEvent(WARD_SELECTED_EVENT, {
      detail: feature
        ? {
          wardCode: feature.properties.code,
          wardName: feature.properties.name,
          constituency: feature.properties.constituency,
          county: feature.properties.county,
          approximate: feature.properties.approximate === true,
          lat: centroid?.lat ?? null,
          lon: centroid?.lon ?? null,
        }
        : null,
    }));
  };

  /**
   * Re-apply fill/outline styling for the current selection.
   * @returns {void}
   */
  const applySelectionStyling = () => {
    if (!dataSource) return;
    for (const entity of dataSource.entities.values) {
      const code = entity.properties?.wardCode?.getValue?.();
      if (!code) continue;
      const selected = code === selectedWardCode;
      if (entity.polygon) {
        entity.polygon.material = new Cesium.ColorMaterialProperty(
          Cesium.Color.fromCssColorString(entity.__kilimoAccent)
            .withAlpha(selected ? 0.24 : 0.08),
        );
      }
      if (entity.polyline) {
        if (entity[CASING_FLAG]) {
          // The casing only ever thickens — recolouring it would defeat its job.
          entity.polyline.width = selected ? LINE.wardCasingSelected : LINE.wardCasing;
        } else {
          entity.polyline.width = selected ? LINE.wardCoreSelected : LINE.wardCore;
          entity.polyline.material = new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString(entity.__kilimoAccent).withAlpha(1),
          );
        }
      }
    }
  };

  return defineKilimoLayer({
    id: 'wards',
    label: "Murang'a / Kandara wards",
    name: 'Wards',
    icon: '🗺️',
    source: 'geoBoundaries gbOpen KEN ADM1/ADM3 (IEBC-derived)',
    ctx,
    count: () => wardFeatures.length,
    resolve: (name) => {
      const centroid = WARD_CENTROIDS.find(
        (ward) => normalizePlace(ward.name) === normalizePlace(name),
      );
      return centroid ? { lat: centroid.lat, lon: centroid.lon, altitude: 7000 } : null;
    },

    onEnable: async (viewer, publisher) => {
      overlayPublisher = publisher;
      const [{ kandara }, countyFeature] = await Promise.all([
        loadWardFeatures(),
        loadCountyFeature(),
      ]);
      wardFeatures = kandara;

      dataSource = new Cesium.CustomDataSource('kilimo-wards');

      // County outline: a dim, wide, non-interactive frame that establishes
      // where Kandara sits inside Murang'a.
      if (countyFeature) {
        for (const [index, positions] of outlineRings(countyFeature.geometry).entries()) {
          dataSource.entities.add({
            id: `${WARD_ENTITY_PREFIX}county-021-casing-${index}`,
            polyline: {
              positions,
              width: LINE.countyCasing,
              clampToGround: true,
              material: new Cesium.ColorMaterialProperty(CASING_COLOR),
            },
          });
          dataSource.entities.add({
            id: `${WARD_ENTITY_PREFIX}county-021-ring-${index}`,
            polyline: {
              positions,
              width: LINE.countyCore,
              clampToGround: true,
              material: new Cesium.ColorMaterialProperty(
                Cesium.Color.fromCssColorString(ACCENT).withAlpha(0.85),
              ),
            },
          });
        }
      }

      for (const feature of wardFeatures) {
        const properties = feature.properties || {};
        const approximate = properties.approximate === true;
        const accent = approximate ? APPROXIMATE_ACCENT : ACCENT;
        const color = Cesium.Color.fromCssColorString(accent);

        for (const [index, hierarchy] of polygonHierarchies(feature.geometry).entries()) {
          const entity = dataSource.entities.add({
            id: `${WARD_ENTITY_PREFIX}${properties.code}-${index}`,
            name: properties.name,
            polygon: {
              hierarchy,
              material: new Cesium.ColorMaterialProperty(color.withAlpha(0.08)),
              // Terrain-draped, and NOT outlined here: Cesium's polygon outline
              // is 1 px and unstyleable, so the glowing edge is a real polyline.
              classificationType: Cesium.ClassificationType.BOTH,
              perPositionHeight: false,
            },
            properties: {
              wardCode: properties.code,
              wardName: properties.name,
              approximate,
            },
          });
          entity.__kilimoAccent = accent;
        }

        for (const [index, positions] of outlineRings(feature.geometry).entries()) {
          // Casing first so the core always draws over it.
          const casing = dataSource.entities.add({
            id: `${WARD_ENTITY_PREFIX}${properties.code}-casing-${index}`,
            polyline: {
              positions,
              width: LINE.wardCasing,
              clampToGround: true,
              material: new Cesium.ColorMaterialProperty(CASING_COLOR),
            },
            properties: {
              wardCode: properties.code,
              wardName: properties.name,
              approximate,
            },
          });
          casing.__kilimoAccent = accent;
          casing[CASING_FLAG] = true;

          const entity = dataSource.entities.add({
            id: `${WARD_ENTITY_PREFIX}${properties.code}-outline-${index}`,
            polyline: {
              positions,
              width: LINE.wardCore,
              clampToGround: true,
              // Solid, not glow: an opaque core stays crisp over imagery where
              // a glow just smears the edge into the hillside behind it.
              material: new Cesium.ColorMaterialProperty(
                color.withAlpha(approximate ? 0.8 : 0.98),
              ),
            },
            properties: {
              wardCode: properties.code,
              wardName: properties.name,
              approximate,
            },
          });
          entity.__kilimoAccent = accent;
        }
      }

      await viewer.dataSources.add(dataSource);
      dataSource.show = true;
      publishEntries();

      pickHandle = installKilimoPickHandler({
        viewer,
        Cesium,
        layerId: 'wards',
        prefix: WARD_ENTITY_PREFIX,
        onSelect: (suffix) => {
          // Ids: `<code>-<index>`, `<code>-outline-<index>`, `<code>-casing-<index>`.
          // Ward codes are numeric, so the first dash-segment is always the code.
          const code = suffix.split('-')[0];
          selectWard(wardFeatures.some((f) => f.properties?.code === code) ? code : '');
        },
      });
    },

    onDisable: (viewer) => {
      pickHandle?.destroy();
      pickHandle = null;
      selectedWardCode = '';
      overlayPublisher = null;
      if (dataSource) {
        viewer?.dataSources?.remove(dataSource, true);
        dataSource = null;
      }
    },

    extra: {
      /** @returns {string} Selected ward code ('' when none). */
      getSelectedWardCode: () => selectedWardCode,
      /**
       * Programmatic selection, used by the action runner / scenes.
       * @param {string} wardCode
       * @returns {void}
       */
      selectWard: (wardCode) => selectWard(String(wardCode || '')),
    },
  });
}

/**
 * Normalize a place name for comparison: case-, apostrophe- and
 * separator-insensitive, so "Ng'araria", "ngararia" and "NG ARARIA" match.
 * @param {string} value
 * @returns {string}
 */
export function normalizePlace(value) {
  return String(value ?? '')
    .toLocaleLowerCase()
    .replace(/[‘’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}
