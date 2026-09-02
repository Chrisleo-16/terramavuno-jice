/**
 * @module data/kilimo/programmeLayer
 * @description Layer 'programme' — a county-anchored card that states the
 * published rules of the National Fertilizer Subsidy Programme: each of the
 * five criteria as its own row with its own evidence chip, the allocation
 * formula, and the source citation with its effective date.
 *
 * This layer PUBLISHES RULES; it never decides anything. The deterministic
 * engine in `packages/shared/src/eligibility` decides, and Claude explains.
 * Rendering the criteria separately is what lets a viewer check the decision
 * against the rule that produced it.
 */

import * as Cesium from 'cesium';
import {
  CONSTITUENCY_NAME,
  COUNTY_CENTROID,
  COUNTY_NAME,
  PROGRAMME,
  isoDate,
} from './kilimoData.js';
import {
  TRUTH_COLORS,
  evidenceChipText,
  setEvidenceDecoration,
} from './evidenceBadges.js';
import { defineKilimoLayer, kilimoEntryDefaults } from './layerKit.js';

/** Overlay entry id of the main programme card. */
export const PROGRAMME_CARD_ID = 'programme-ken-fert-subsidy-2026';

/**
 * The programme card's detail lines: header, one row per criterion (each with
 * its own chip), the allocation formula, and the citation.
 * @returns {string[]}
 */
export function programmeCardLines() {
  const lines = [
    `${PROGRAMME.season} · ${COUNTY_NAME} county (${CONSTITUENCY_NAME})`,
    `Rules published by ${PROGRAMME.source}, effective ${isoDate(PROGRAMME.effectiveFrom) || PROGRAMME.effectiveFrom}`,
    '',
    'ELIGIBILITY CRITERIA',
  ];
  for (const criterion of PROGRAMME.criteria) {
    const cap = criterion.param !== undefined ? ` (${criterion.param} acres)` : '';
    lines.push(`• ${criterion.label}${cap}`);
    lines.push(`   ${evidenceChipText(criterion.evidence)}`);
  }
  lines.push('');
  lines.push('ALLOCATION');
  lines.push(
    `• ${PROGRAMME.allocationFormula.bagsPerAcre} bags per acre, capped at `
    + `${PROGRAMME.allocationFormula.maxBags} bags per registered farmer`,
  );
  lines.push(`   ${evidenceChipText(PROGRAMME.evidence)}`);
  lines.push('');
  lines.push(`Participating wards: ${PROGRAMME.participatingWards.join(', ')}`);
  lines.push(PROGRAMME.evidence.citation);
  return lines;
}

/**
 * Build the 'programme' layer.
 * @param {object} ctx Layer context from registerKilimoLayers.
 * @returns {object} Dual-contract layer object.
 */
export function createProgrammeLayer(ctx) {
  /** @type {object|null} */
  let overlayPublisher = null;

  /**
   * Publish the single programme card.
   * @returns {void}
   */
  const publishEntries = () => {
    if (!overlayPublisher) return;
    overlayPublisher.publish([
      kilimoEntryDefaults({
        id: PROGRAMME_CARD_ID,
        source: 'kilimo-programme',
        // Anchored slightly north-west of the county centroid so it does not
        // sit on top of the county-name card the ward layer publishes there.
        position: Cesium.Cartesian3.fromDegrees(
          COUNTY_CENTROID.lon - 0.09,
          COUNTY_CENTROID.lat + 0.06,
          0,
        ),
        title: PROGRAMME.name,
        details: programmeCardLines(),
        accent: TRUTH_COLORS.official,
        // A rules card is the reference every other card is read against, so
        // it outranks ambient labels and is protected from decluttering.
        priority: 900,
        pinned: true,
        protected: true,
        placement: 'left',
        gapPx: 18,
        interactive: true,
        accessibilityLabel: `${PROGRAMME.name} rules card`,
        activate: () => {
          ctx.focusTarget({ lat: COUNTY_CENTROID.lat, lon: COUNTY_CENTROID.lon, altitude: 62000 });
          return true;
        },
      }),
    ]);
    setEvidenceDecoration('kilimo-programme', PROGRAMME_CARD_ID, {
      tags: [PROGRAMME.evidence, ...PROGRAMME.criteria.map((criterion) => criterion.evidence)],
      simulated: false,
    });
  };

  return defineKilimoLayer({
    id: 'programme',
    label: 'Subsidy programme rules',
    name: 'Programme',
    icon: '📋',
    source: 'MoALD subsidy circular (effective 2026-08-14)',
    ctx,
    // The count the panel row shows is the number of published criteria — the
    // honest measure of "how much rule is on screen".
    count: () => PROGRAMME.criteria.length,
    resolve: () => ({ lat: COUNTY_CENTROID.lat, lon: COUNTY_CENTROID.lon, altitude: 62000 }),

    onEnable: (viewer, publisher) => {
      overlayPublisher = publisher;
      publishEntries();
    },

    onDisable: () => {
      overlayPublisher = null;
    },

    extra: {
      /** @returns {object} The programme record this layer renders. */
      getProgramme: () => PROGRAMME,
    },
  });
}
