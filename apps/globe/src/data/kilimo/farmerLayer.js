/**
 * @module data/kilimo/farmerLayer
 * @description Layer 'farmers' — the synthetic farmer tokens, pinned near
 * their ward centroids and coloured by state.
 *
 * NO REAL PERSONAL DATA EXISTS HERE. Every token is a demo fixture, labelled
 * pseudonymously ("Farmer token K-001"), and every card is stamped with the
 * SIMULATED watermark by the evidence paint lane. The cards state the token's
 * ATTRIBUTES (register flag, ID linkage, acreage, crop) and never a verdict:
 * the deterministic engine decides eligibility, so this layer shows the
 * expected demo archetype only as a "demo expectation" line.
 *
 * Events dispatched on `window` — this is the documented seam the chat and
 * voice agents react to, so nothing needs to import this module:
 *   `kilimo:farmer-selected` → `{ detail: { token, state, wardCode, wardName,
 *      assignedDepotId, attributes, lat, lon } }`, and `{ detail: null }` when
 *      the selection is cleared.
 */

import * as Cesium from 'cesium';
import {
  FARMERS,
  PROGRAMME,
  SIJUI_SENTENCE,
  allocationBagsFor,
  depotById,
  wardCentroidByName,
} from './kilimoData.js';
import {
  CONCLUSION_LABELS,
  TRUTH_COLORS,
  evidenceChipText,
  setEvidenceDecoration,
} from './evidenceBadges.js';
import { defineKilimoLayer, installKilimoPickHandler, kilimoEntryDefaults } from './layerKit.js';
import { normalizePlace } from './wardLayer.js';

/** Entity-id prefix — also the pick-ownership key for this layer. */
export const FARMER_ENTITY_PREFIX = 'kilimo-farmer:';
/** CustomEvent name fired when a farmer token is clicked (or cleared). */
export const FARMER_SELECTED_EVENT = 'kilimo:farmer-selected';

/** Farmer state → truth-model tone colour. */
export const FARMER_STATE_COLORS = Object.freeze({
  registered: TRUTH_COLORS.official,
  missing_requirement: TRUTH_COLORS.reported,
  ineligible: TRUTH_COLORS.stale,
  unknown: TRUTH_COLORS.simulated,
});

/** Farmer state → human copy. */
export const FARMER_STATE_LABELS = Object.freeze({
  registered: 'Registered smallholder',
  missing_requirement: 'Registered, requirement missing',
  ineligible: 'Registered, outside the rules',
  unknown: 'Register status unverifiable',
});

/**
 * Offset a token marker away from its ward centroid so the token and the ward
 * label do not sit on the same pixel. Deterministic per token, so a recorded
 * scene replays identically.
 * @param {string} token Token code, e.g. 'K-001'.
 * @returns {{dLat:number, dLon:number}} Degrees offset.
 */
export function tokenOffset(token) {
  const index = Math.max(0, FARMERS.findIndex((farmer) => farmer.token === token));
  const angle = (index / Math.max(1, FARMERS.length)) * Math.PI * 2;
  const radius = 0.012;
  return { dLat: Math.sin(angle) * radius, dLon: Math.cos(angle) * radius };
}

/**
 * Build the 'farmers' layer.
 * @param {object} ctx Layer context from registerKilimoLayers.
 * @returns {object} Dual-contract layer object.
 */
export function createFarmerLayer(ctx) {
  /** @type {Cesium.CustomDataSource|null} */
  let dataSource = null;
  /** @type {{destroy:function():void}|null} */
  let pickHandle = null;
  /** @type {string} */
  let selectedToken = '';
  /** @type {object|null} */
  let overlayPublisher = null;

  /**
   * Resolve a token's map position (ward centroid + deterministic offset).
   * @param {object} farmer Farmer token record.
   * @returns {{lat:number, lon:number}|null}
   */
  const tokenPosition = (farmer) => {
    const centroid = wardCentroidByName(farmer.wardName);
    if (!centroid) return null;
    const { dLat, dLon } = tokenOffset(farmer.token);
    return { lat: centroid.lat + dLat, lon: centroid.lon + dLon };
  };

  /**
   * Card copy for one token. States attributes and the demo expectation, never
   * a verdict of its own.
   * @param {object} farmer Farmer token record.
   * @returns {string[]} Detail lines.
   */
  const farmerDetails = (farmer) => {
    const depot = depotById(farmer.assignedDepotId);
    const registerText = farmer.attributes.inFarmerRegister === 'unknown'
      ? 'unknown'
      : (farmer.attributes.inFarmerRegister ? 'yes' : 'no');
    const acreage = Number.isFinite(Number(farmer.attributes.acreage))
      ? `${farmer.attributes.acreage} acres`
      : 'acreage unknown';
    const bags = allocationBagsFor(farmer.attributes.acreage);
    const lines = [
      `${FARMER_STATE_LABELS[farmer.state] || farmer.state} · ${farmer.wardName} ward`,
      `In farmer register: ${registerText} · national ID linked: ${farmer.attributes.nationalIdLinked ? 'yes' : 'no'}`,
      `${acreage} · ${farmer.attributes.crop} · prior redemptions: ${farmer.attributes.priorRedemptions}`,
      bags === null
        ? 'Allocation cannot be computed (acreage unknown)'
        : `Rule allocation if eligible: ${bags} bags (${PROGRAMME.allocationFormula.bagsPerAcre}/acre, cap ${PROGRAMME.allocationFormula.maxBags}) — calculated`,
      depot
        ? `Assigned collection point: ${depot.name}`
        : 'No assigned collection point',
      `Demo expectation: ${CONCLUSION_LABELS[farmer.expectedConclusion] || 'Cannot determine'} `
        + '(the deterministic engine decides — this layer only shows inputs)',
      evidenceChipText(farmer.evidence),
    ];
    if (farmer.expectedConclusion === 'indicated_by_published_rules') {
      lines.push(SIJUI_SENTENCE);
    }
    return lines;
  };

  /**
   * Publish the token cards through the world overlay.
   * @returns {void}
   */
  const publishEntries = () => {
    if (!overlayPublisher) return;
    const entries = [];
    for (const farmer of FARMERS) {
      const position = tokenPosition(farmer);
      if (!position) continue;
      const selected = farmer.token === selectedToken;
      const accent = FARMER_STATE_COLORS[farmer.state] || TRUTH_COLORS.simulated;
      const entryId = `farmer-${farmer.token}`;
      entries.push(kilimoEntryDefaults({
        id: entryId,
        source: 'kilimo-farmers',
        position: Cesium.Cartesian3.fromDegrees(position.lon, position.lat, 0),
        variant: selected ? 'selected' : 'card',
        selected,
        title: `Farmer token ${farmer.token}`,
        details: farmerDetails(farmer),
        accent,
        priority: 200 + (selected ? 500 : 0),
        interactive: true,
        accessibilityLabel: `Farmer token ${farmer.token}, ${farmer.wardName} ward (simulated)`,
        activate: () => {
          selectFarmer(farmer.token);
          return true;
        },
      }));
      setEvidenceDecoration('kilimo-farmers', entryId, {
        // Every token is simulated, so every card is watermarked.
        tags: [farmer.evidence],
        simulated: true,
        conclusion: selected ? farmer.expectedConclusion : null,
        pulse: false,
      });
    }
    overlayPublisher.publish(entries);
  };

  /**
   * Select a token and announce it on the documented CustomEvent.
   * @param {string} token Token code, or '' to clear.
   * @returns {void}
   */
  const selectFarmer = (token) => {
    if (selectedToken === token) return;
    selectedToken = token || '';
    applySelectionStyling();
    publishEntries();
    const farmer = FARMERS.find((candidate) => candidate.token === selectedToken) || null;
    const position = farmer ? tokenPosition(farmer) : null;
    window.dispatchEvent(new CustomEvent(FARMER_SELECTED_EVENT, {
      detail: farmer
        ? {
          token: farmer.token,
          state: farmer.state,
          wardCode: farmer.wardCode,
          wardName: farmer.wardName,
          assignedDepotId: farmer.assignedDepotId,
          attributes: { ...farmer.attributes },
          lat: position?.lat ?? null,
          lon: position?.lon ?? null,
        }
        : null,
    }));
  };

  /**
   * Enlarge the selected token marker.
   * @returns {void}
   */
  const applySelectionStyling = () => {
    if (!dataSource) return;
    for (const entity of dataSource.entities.values) {
      const token = entity.properties?.token?.getValue?.();
      if (!token || !entity.point) continue;
      const selected = token === selectedToken;
      entity.point.pixelSize = selected ? 14 : 9;
      entity.point.outlineWidth = selected ? 3 : 1.5;
    }
  };

  return defineKilimoLayer({
    id: 'farmers',
    label: 'Farmer tokens (SIMULATED)',
    name: 'Farmers',
    icon: '🧑‍🌾',
    source: 'SIMULATED demo tokens — no real personal data',
    ctx,
    count: () => FARMERS.length,
    resolve: (name) => {
      const query = normalizePlace(name);
      const farmer = FARMERS.find((candidate) => normalizePlace(candidate.token) === query);
      if (!farmer) return null;
      const position = tokenPosition(farmer);
      return position ? { lat: position.lat, lon: position.lon, altitude: 5000 } : null;
    },

    onEnable: async (viewer, publisher) => {
      overlayPublisher = publisher;
      dataSource = new Cesium.CustomDataSource('kilimo-farmers');
      for (const farmer of FARMERS) {
        const position = tokenPosition(farmer);
        if (!position) continue;
        const color = Cesium.Color.fromCssColorString(
          FARMER_STATE_COLORS[farmer.state] || TRUTH_COLORS.simulated,
        );
        dataSource.entities.add({
          id: `${FARMER_ENTITY_PREFIX}${farmer.token}`,
          name: `Farmer token ${farmer.token}`,
          position: Cesium.Cartesian3.fromDegrees(position.lon, position.lat, 0),
          point: {
            pixelSize: 9,
            color: color.withAlpha(0.92),
            // Violet ring on every token: the classification is visible on the
            // marker itself, not only on the card.
            outlineColor: Cesium.Color.fromCssColorString(TRUTH_COLORS.simulated).withAlpha(0.9),
            outlineWidth: 1.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: {
            token: farmer.token,
            state: farmer.state,
            wardCode: farmer.wardCode,
            classification: 'simulated',
          },
        });
      }
      await viewer.dataSources.add(dataSource);
      dataSource.show = true;
      publishEntries();

      pickHandle = installKilimoPickHandler({
        viewer,
        Cesium,
        layerId: 'farmers',
        prefix: FARMER_ENTITY_PREFIX,
        onSelect: (token) => selectFarmer(
          FARMERS.some((farmer) => farmer.token === token) ? token : '',
        ),
      });
    },

    onDisable: (viewer) => {
      pickHandle?.destroy();
      pickHandle = null;
      selectedToken = '';
      overlayPublisher = null;
      if (dataSource) {
        viewer?.dataSources?.remove(dataSource, true);
        dataSource = null;
      }
    },

    extra: {
      /** @returns {string} Selected token ('' when none). */
      getSelectedToken: () => selectedToken,
      /**
       * Programmatic selection — dispatches `kilimo:farmer-selected` exactly as
       * a click does, so the chat/voice agent has one code path.
       * @param {string} token
       * @returns {void}
       */
      selectFarmer: (token) => selectFarmer(String(token || '')),
    },
  });
}
