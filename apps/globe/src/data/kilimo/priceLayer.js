/**
 * @module data/kilimo/priceLayer
 * @description Layer 'prices' — the price and allocation schedule card:
 * subsidized KES 2,500 against a market reference of KES 6,500 per 50 kg bag,
 * the 2 bags/acre allocation capped at 10, the validity window, and the
 * gazette citation with its effective date.
 *
 * The savings line is arithmetic on two published prices, so it is tagged
 * DERIVATION 'calculated' — never presented as an officially published figure.
 */

import * as Cesium from 'cesium';
import {
  COUNTY_CENTROID,
  PRICE_ROW,
  PROGRAMME,
  formatKes,
  isoDate,
  savingsPerBagKes,
} from './kilimoData.js';
import {
  TRUTH_COLORS,
  evidenceChipText,
  setEvidenceDecoration,
} from './evidenceBadges.js';
import { defineKilimoLayer, kilimoEntryDefaults } from './layerKit.js';

/** Overlay entry id of the price card. */
export const PRICE_CARD_ID = 'prices-planting-fertilizer-2026';

/**
 * The evidence tag for the computed savings line: same source, but CALCULATED.
 * @type {object}
 */
export const SAVINGS_EVIDENCE = Object.freeze({
  authority: PRICE_ROW.evidence.authority,
  derivation: 'calculated',
  freshness: PRICE_ROW.evidence.freshness,
  sourceId: PRICE_ROW.evidence.sourceId,
  citation: 'Saving computed as (market reference − subsidized price) × bags — derived from the Kenya Gazette price notice, not itself a published figure',
});

/**
 * The price card's detail lines.
 * @returns {string[]}
 */
export function priceCardLines() {
  const perBag = savingsPerBagKes();
  const maxBags = PROGRAMME.allocationFormula.maxBags;
  return [
    `Planting fertilizer · ${PRICE_ROW.bagWeightKg} kg bag · ${PROGRAMME.season}`,
    '',
    `Subsidized  ${formatKes(PRICE_ROW.subsidizedPriceKes)} per bag`,
    `Market ref. ${formatKes(PRICE_ROW.marketPriceKes)} per bag`,
    `${evidenceChipText(PRICE_ROW.evidence)}`,
    '',
    'ALLOCATION',
    `• ${PROGRAMME.allocationFormula.bagsPerAcre} bags per acre, capped at ${maxBags} bags`,
    '',
    'SAVING (CALCULATED)',
    `• ${formatKes(perBag)} per bag · up to ${formatKes(perBag * maxBags)} at the ${maxBags}-bag cap`,
    `   ${evidenceChipText(SAVINGS_EVIDENCE)}`,
    '',
    `Valid ${isoDate(PRICE_ROW.validFrom)} to ${isoDate(PRICE_ROW.validTo)}`,
    PRICE_ROW.evidence.citation,
  ];
}

/**
 * Build the 'prices' layer.
 * @param {object} ctx Layer context from registerKilimoLayers.
 * @returns {object} Dual-contract layer object.
 */
export function createPriceLayer(ctx) {
  /** @type {object|null} */
  let overlayPublisher = null;

  /**
   * Publish the single price card.
   * @returns {void}
   */
  const publishEntries = () => {
    if (!overlayPublisher) return;
    overlayPublisher.publish([
      kilimoEntryDefaults({
        id: PRICE_CARD_ID,
        source: 'kilimo-prices',
        // East of the county centroid, mirroring the programme card to its
        // west, so both rules cards can be on screen at once.
        position: Cesium.Cartesian3.fromDegrees(
          COUNTY_CENTROID.lon + 0.09,
          COUNTY_CENTROID.lat + 0.06,
          0,
        ),
        title: 'Price & allocation schedule',
        details: priceCardLines(),
        accent: TRUTH_COLORS.official,
        priority: 880,
        pinned: true,
        protected: true,
        placement: 'right',
        gapPx: 18,
        interactive: true,
        accessibilityLabel: 'Subsidized and market price schedule',
        activate: () => {
          ctx.focusTarget({ lat: COUNTY_CENTROID.lat, lon: COUNTY_CENTROID.lon, altitude: 62000 });
          return true;
        },
      }),
    ]);
    setEvidenceDecoration('kilimo-prices', PRICE_CARD_ID, {
      tags: [PRICE_ROW.evidence, SAVINGS_EVIDENCE],
      simulated: false,
    });
  };

  return defineKilimoLayer({
    id: 'prices',
    label: 'Price & allocation schedule',
    name: 'Prices',
    icon: '💰',
    source: 'Kenya Gazette price notice (effective 2026-08-14)',
    ctx,
    // One priced input row today; the count is the honest size of the schedule.
    count: () => 1,
    resolve: () => ({ lat: COUNTY_CENTROID.lat, lon: COUNTY_CENTROID.lon, altitude: 62000 }),

    onEnable: (viewer, publisher) => {
      overlayPublisher = publisher;
      publishEntries();
    },

    onDisable: () => {
      overlayPublisher = null;
    },

    extra: {
      /** @returns {object} The price row this layer renders. */
      getPriceRow: () => PRICE_ROW,
    },
  });
}
