/**
 * @module data/kilimo/depotLayer
 * @description Layer 'depots' — fertilizer collection points, coloured by
 * stock status, with the selected depot ringed by a pulse.
 *
 * COLOUR = OPERATIONAL TRUTH, not decoration:
 *   in_stock → `--official` (green)   · low → `--reported` (amber)
 *   unknown  → `--stale`    (red)     — including the deliberate sijui depot.
 *
 * Every card states the stock status WITH its `checked_at` timestamp, or the
 * words "stock not verified" when `checkedAt` is null — the demo's whole point
 * is that an unverifiable operational fact is said out loud, not smoothed over.
 * SIMULATED depots additionally get a violet chip and a SIMULATED watermark
 * stamped across the card by the evidence paint lane.
 *
 * Events dispatched on `window`:
 *   `kilimo:depot-selected` → `{ detail: { depotId, name, merchant, assetType,
 *      stockStatus, checkedAt, classification, lat, lon } }` (null on clear).
 */

import * as Cesium from 'cesium';
import {
  DEPOTS,
  PROGRAMME,
  depotById,
  isoMinuteUtc,
} from './kilimoData.js';
import {
  TRUTH_COLORS,
  evidenceChipText,
  setEvidenceDecoration,
} from './evidenceBadges.js';
import { defineKilimoLayer, installKilimoPickHandler, kilimoEntryDefaults } from './layerKit.js';
import { holdContinuousRender, releaseContinuousRender } from '../../renderGovernor.js';
import { normalizePlace } from './wardLayer.js';

/** Entity-id prefix — also the pick-ownership key for this layer. */
export const DEPOT_ENTITY_PREFIX = 'kilimo-depot:';
/** CustomEvent name fired when a depot is clicked (or the selection cleared). */
export const DEPOT_SELECTED_EVENT = 'kilimo:depot-selected';

/** Stock status → truth-model tone colour. */
export const STOCK_COLORS = Object.freeze({
  in_stock: TRUTH_COLORS.official,
  low: TRUTH_COLORS.reported,
  unknown: TRUTH_COLORS.stale,
});

/** Stock status → human copy. */
export const STOCK_LABELS = Object.freeze({
  in_stock: 'In stock',
  low: 'Low stock',
  unknown: 'Stock unknown',
});

/**
 * The stock line for a depot card: status plus the timestamp that backs it, or
 * an explicit "stock not verified" when nothing backs it.
 * @param {object} depot Depot record.
 * @returns {string}
 */
export function stockLine(depot) {
  const label = STOCK_LABELS[depot?.stockStatus] || 'Stock unknown';
  const checked = isoMinuteUtc(depot?.checkedAt);
  return checked ? `${label} · checked ${checked}` : `${label} · stock not verified`;
}

/**
 * Build the 'depots' layer.
 * @param {object} ctx Layer context from registerKilimoLayers.
 * @returns {object} Dual-contract layer object.
 */
export function createDepotLayer(ctx) {
  /** @type {Cesium.CustomDataSource|null} */
  let dataSource = null;
  /** @type {{destroy:function():void}|null} */
  let pickHandle = null;
  /** @type {string} */
  let selectedDepotId = '';
  /** @type {object|null} */
  let overlayPublisher = null;
  let pulseHeld = false;

  /**
   * The pulse ring is an animation, so it needs frames. Hold the render
   * governor open ONLY while a depot is selected, and release it the moment
   * the selection clears — an idle globe must go back to on-demand rendering.
   * @param {boolean} active
   * @returns {void}
   */
  const setPulseRender = (active) => {
    if (active === pulseHeld) return;
    pulseHeld = active;
    if (active) holdContinuousRender('kilimo-depot-pulse');
    else releaseContinuousRender('kilimo-depot-pulse');
  };

  /**
   * Card copy for one depot.
   * @param {object} depot Depot record.
   * @returns {string[]} Detail lines.
   */
  const depotDetails = (depot) => {
    const lines = [
      depot.merchant,
      `${depot.assetType === 'ncpb_depot' ? 'NCPB depot' : 'Agro-dealer'}`
        + `${depot.town ? ` · ${depot.town}, ${depot.county}` : ''}`,
      stockLine(depot),
      `e-voucher: present your registered national ID · ${PROGRAMME.season}`,
      evidenceChipText(depot.evidence),
    ];
    if (depot.classification === 'simulated') {
      lines.push('SIMULATED collection point — demo stand-in, not a real outlet');
    }
    return lines;
  };

  /**
   * Publish the depot cards through the world overlay.
   * @returns {void}
   */
  const publishEntries = () => {
    if (!overlayPublisher) return;
    const entries = [];
    for (const depot of DEPOTS) {
      const selected = depot.id === selectedDepotId;
      const accent = STOCK_COLORS[depot.stockStatus] || TRUTH_COLORS.stale;
      const entryId = `depot-${depot.id}`;
      entries.push(kilimoEntryDefaults({
        id: entryId,
        source: 'kilimo-depots',
        position: Cesium.Cartesian3.fromDegrees(depot.lon, depot.lat, 0),
        variant: selected ? 'selected' : 'card',
        selected,
        title: depot.name,
        details: depotDetails(depot),
        accent,
        // Official, stock-verified depots win a contested label slot.
        priority: (depot.classification === 'official' ? 300 : 150)
          + (depot.stockStatus === 'in_stock' ? 20 : 0)
          + (selected ? 500 : 0),
        interactive: true,
        accessibilityLabel: `${depot.name} — ${STOCK_LABELS[depot.stockStatus] || 'stock unknown'}`,
        activate: () => {
          selectDepot(depot.id);
          return true;
        },
      }));
      setEvidenceDecoration('kilimo-depots', entryId, {
        tags: [depot.evidence],
        simulated: depot.classification === 'simulated',
        pulse: selected,
        pulseColor: accent,
      });
    }
    overlayPublisher.publish(entries);
  };

  /**
   * Select a depot by id and announce it.
   * @param {string} depotId Depot id, or '' to clear.
   * @returns {void}
   */
  const selectDepot = (depotId) => {
    if (selectedDepotId === depotId) return;
    selectedDepotId = depotId || '';
    setPulseRender(Boolean(selectedDepotId));
    applySelectionStyling();
    publishEntries();
    const depot = depotById(selectedDepotId);
    window.dispatchEvent(new CustomEvent(DEPOT_SELECTED_EVENT, {
      detail: depot
        ? {
          depotId: depot.id,
          name: depot.name,
          merchant: depot.merchant,
          assetType: depot.assetType,
          stockStatus: depot.stockStatus,
          checkedAt: depot.checkedAt,
          classification: depot.classification,
          lat: depot.lat,
          lon: depot.lon,
        }
        : null,
    }));
  };

  /**
   * Grow/brighten the selected marker; the animated ring itself is painted by
   * the evidence overlay lane so it stays in the same canvas as the card.
   * @returns {void}
   */
  const applySelectionStyling = () => {
    if (!dataSource) return;
    for (const entity of dataSource.entities.values) {
      const depotId = entity.properties?.depotId?.getValue?.();
      if (!depotId || !entity.point) continue;
      const selected = depotId === selectedDepotId;
      entity.point.pixelSize = selected ? 15 : 10;
      entity.point.outlineWidth = selected ? 3 : 1.5;
    }
  };

  return defineKilimoLayer({
    id: 'depots',
    label: 'Collection depots',
    name: 'Depots',
    icon: '🏬',
    source: 'NCPB depot register (1 cited) + 3 SIMULATED agro-dealers',
    ctx,
    count: () => DEPOTS.length,
    resolve: (name) => {
      const query = normalizePlace(name);
      const depot = DEPOTS.find((candidate) => normalizePlace(candidate.id) === query
        || normalizePlace(candidate.name) === query
        || normalizePlace(candidate.town) === query);
      return depot ? { lat: depot.lat, lon: depot.lon, altitude: 4500 } : null;
    },

    onEnable: async (viewer, publisher) => {
      overlayPublisher = publisher;
      dataSource = new Cesium.CustomDataSource('kilimo-depots');
      for (const depot of DEPOTS) {
        const color = Cesium.Color.fromCssColorString(
          STOCK_COLORS[depot.stockStatus] || TRUTH_COLORS.stale,
        );
        dataSource.entities.add({
          id: `${DEPOT_ENTITY_PREFIX}${depot.id}`,
          name: depot.name,
          position: Cesium.Cartesian3.fromDegrees(depot.lon, depot.lat, 0),
          point: {
            pixelSize: 10,
            color: color.withAlpha(0.9),
            outlineColor: Cesium.Color.fromCssColorString('#0a0a0f').withAlpha(0.85),
            outlineWidth: 1.5,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          properties: {
            depotId: depot.id,
            stockStatus: depot.stockStatus,
            classification: depot.classification,
          },
        });
      }
      await viewer.dataSources.add(dataSource);
      dataSource.show = true;
      publishEntries();

      pickHandle = installKilimoPickHandler({
        viewer,
        Cesium,
        layerId: 'depots',
        prefix: DEPOT_ENTITY_PREFIX,
        onSelect: (depotId) => selectDepot(depotById(depotId) ? depotId : ''),
      });
    },

    onDisable: (viewer) => {
      pickHandle?.destroy();
      pickHandle = null;
      selectedDepotId = '';
      setPulseRender(false);
      overlayPublisher = null;
      if (dataSource) {
        viewer?.dataSources?.remove(dataSource, true);
        dataSource = null;
      }
    },

    extra: {
      /** @returns {string} Selected depot id ('' when none). */
      getSelectedDepotId: () => selectedDepotId,
      /**
       * Programmatic selection, used by the action runner, the result card and
       * the scene recipes.
       * @param {string} depotId
       * @returns {void}
       */
      selectDepot: (depotId) => selectDepot(String(depotId || '')),
    },
  });
}
