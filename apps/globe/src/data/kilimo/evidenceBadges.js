/**
 * @module data/kilimo/evidenceBadges
 * @description THE single renderer for the TerraMavuno truth model.
 *
 * Every fact on this globe carries an EvidenceTag =
 * Authority (official | reported) × Derivation (direct | calculated | inferred
 * | simulated) × Freshness (checkedAt + current | stale | unknown), and every
 * operational answer resolves to one Conclusion (confirmed |
 * indicated_by_published_rules | cannot_determine).
 *
 * A chip renders as `[Official · Direct · 2026-08-14]` and is coloured by ONE
 * tone, resolved with this documented precedence (first match wins):
 *
 *   1. derivation 'simulated'        → `--simulated` (violet)  — a fabricated
 *      fact must announce itself even when its freshness looks healthy.
 *   2. freshness 'unknown' | 'stale' → `--stale` (red)         — we cannot
 *      vouch for the value today.
 *   3. authority 'reported'          → `--reported` (amber)
 *   4. otherwise                     → `--official` (green)
 *
 * Both renderers below read the same tone, so a chip on a canvas world-overlay
 * card and a chip in an HTML panel are the same chip.
 *
 * Canvas chips are painted by a world-overlay CUSTOM PAINT LANE
 * (`installEvidenceOverlayLane`) that runs in the 'tracked' lane — i.e. after
 * every ambient/selected card has painted and published its rectangle — so it
 * can decorate a card the host drew without owning the card itself.
 */

import {
  getOverlayPaintRect,
  registerWorldOverlayPaintLane,
} from '../../overlays/worldOverlay.js';
import { WORLD_OVERLAY_STYLE } from '../../overlays/worldOverlayTokens.js';
import { isoDate } from './kilimoData.js';

/**
 * Truth-model colours. These are the literal values of the CSS custom
 * properties in style.css (`--official`, `--reported`, `--simulated`,
 * `--stale`); Canvas2D cannot read CSS variables, so the hexes live here and
 * the DOM helper emits `var(--official, #34d17b)` so a theme retune still wins
 * in HTML.
 */
export const TRUTH_COLORS = Object.freeze({
  official: '#34d17b',
  reported: '#f5b942',
  simulated: '#a78bfa',
  stale: '#f87171',
});

/** CSS custom-property name per tone. */
export const TRUTH_CSS_VARS = Object.freeze({
  official: '--official',
  reported: '--reported',
  simulated: '--simulated',
  stale: '--stale',
});

/** Human labels for the three operational conclusions. */
export const CONCLUSION_LABELS = Object.freeze({
  confirmed: 'Confirmed',
  indicated_by_published_rules: 'Indicated by published rules',
  cannot_determine: 'Cannot determine',
});

/** Tone per conclusion: a confirmed NEGATIVE is still confirmed (green). */
export const CONCLUSION_TONES = Object.freeze({
  confirmed: 'official',
  indicated_by_published_rules: 'reported',
  cannot_determine: 'stale',
});

const AUTHORITY_LABELS = Object.freeze({ official: 'Official', reported: 'Reported' });
const DERIVATION_LABELS = Object.freeze({
  direct: 'Direct',
  calculated: 'Calculated',
  inferred: 'Inferred',
  simulated: 'Simulated',
});

/** Canvas font for chips — same mono family as every other overlay glyph. */
export const EVIDENCE_CHIP_FONT = '500 9.5px "JetBrains Mono", monospace';
/** Canvas font for the conclusion pill. */
export const CONCLUSION_PILL_FONT = '600 10px "JetBrains Mono", monospace';
/** Canvas font for the SIMULATED watermark. */
export const SIMULATED_WATERMARK_FONT = '700 13px "JetBrains Mono", monospace';

/**
 * Resolve the single tone of an evidence tag. See the module docblock for the
 * precedence rationale.
 * @param {object|null} tag EvidenceTag-shaped object.
 * @returns {'official'|'reported'|'simulated'|'stale'}
 */
export function evidenceTone(tag) {
  const derivation = String(tag?.derivation || '');
  const status = String(tag?.freshness?.status || '');
  const authority = String(tag?.authority || '');
  if (derivation === 'simulated') return 'simulated';
  if (status === 'unknown' || status === 'stale') return 'stale';
  if (authority === 'reported') return 'reported';
  return 'official';
}

/**
 * Canvas/CSS colour for an evidence tag.
 * @param {object|null} tag EvidenceTag.
 * @returns {string} Hex colour.
 */
export function evidenceColor(tag) {
  return TRUTH_COLORS[evidenceTone(tag)];
}

/**
 * Freshness fragment of a chip: the checked-at DATE, or an honest word when
 * there is no timestamp to show.
 * @param {object|null} tag EvidenceTag.
 * @returns {string}
 */
export function freshnessLabel(tag) {
  const checkedAt = tag?.freshness?.checkedAt ?? null;
  const status = String(tag?.freshness?.status || 'unknown');
  const date = isoDate(checkedAt);
  if (!date) return status === 'stale' ? 'Stale' : 'Unverified';
  if (status === 'stale') return `${date} · Stale`;
  return date;
}

/**
 * The three fragments plus tone/colour of a chip, for callers that lay the
 * chip out themselves.
 * @param {object|null} tag EvidenceTag.
 * @returns {{authority:string, derivation:string, freshness:string, tone:string, color:string, text:string, citation:string}}
 */
export function evidenceChipParts(tag) {
  const authority = AUTHORITY_LABELS[String(tag?.authority)] || 'Unattributed';
  const derivation = DERIVATION_LABELS[String(tag?.derivation)] || 'Unstated';
  const freshness = freshnessLabel(tag);
  const tone = evidenceTone(tag);
  return {
    authority,
    derivation,
    freshness,
    tone,
    color: TRUTH_COLORS[tone],
    text: `[${authority} · ${derivation} · ${freshness}]`,
    citation: String(tag?.citation || ''),
  };
}

/**
 * The chip text, e.g. `[Official · Direct · 2026-08-14]`.
 * @param {object|null} tag EvidenceTag.
 * @returns {string}
 */
export function evidenceChipText(tag) {
  return evidenceChipParts(tag).text;
}

/**
 * The conclusion pill text, e.g. `Indicated by published rules`.
 * @param {string} conclusion One of the three conclusions.
 * @returns {string}
 */
export function conclusionPillText(conclusion) {
  return CONCLUSION_LABELS[String(conclusion)] || 'Cannot determine';
}

/**
 * Colour for a conclusion pill.
 * @param {string} conclusion
 * @returns {string} Hex colour.
 */
export function conclusionColor(conclusion) {
  return TRUTH_COLORS[CONCLUSION_TONES[String(conclusion)] || 'stale'];
}

// ── DOM helpers ────────────────────────────────────────────────────────────

/**
 * Build an evidence chip as a DOM element. Styling is inline so the chip is
 * identical wherever it is mounted (chat panel, result card, layer panel) and
 * does not depend on another agent shipping a stylesheet rule.
 * @param {object|null} tag EvidenceTag.
 * @param {{compact?:boolean, title?:string}} [options] compact drops padding
 *   for dense rows; `title` overrides the hover citation.
 * @returns {HTMLElement} A `<span class="kilimo-chip">`.
 */
export function createEvidenceChip(tag, options = {}) {
  const parts = evidenceChipParts(tag);
  const color = `var(${TRUTH_CSS_VARS[parts.tone]}, ${parts.color})`;
  const chip = document.createElement('span');
  chip.className = `kilimo-chip kilimo-chip-${parts.tone}`;
  chip.dataset.tone = parts.tone;
  chip.textContent = parts.text;
  chip.title = String(options.title || parts.citation || parts.text);
  chip.setAttribute('role', 'note');
  chip.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:4px',
    `padding:${options.compact ? '0 4px' : '1px 6px'}`,
    'border-radius:4px',
    'font-family:var(--font-mono, "JetBrains Mono", monospace)',
    'font-size:9.5px',
    'letter-spacing:0.02em',
    'white-space:nowrap',
    `color:${color}`,
    `border:1px solid ${color}`,
    'background:rgba(4, 12, 16, 0.55)',
  ].join(';');
  return chip;
}

/**
 * Build a row of chips (one per tag), de-duplicated by chip text so a card
 * citing the same circular five times shows one chip.
 * @param {Array<object>} tags EvidenceTags.
 * @param {{compact?:boolean, max?:number}} [options]
 * @returns {HTMLElement} A `<div class="kilimo-chip-row">`.
 */
export function createEvidenceChipRow(tags, options = {}) {
  const row = document.createElement('div');
  row.className = 'kilimo-chip-row';
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center';
  const seen = new Set();
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : Infinity;
  for (const tag of Array.isArray(tags) ? tags : []) {
    const text = evidenceChipText(tag);
    if (seen.has(text)) continue;
    seen.add(text);
    if (seen.size > max) break;
    row.appendChild(createEvidenceChip(tag, options));
  }
  return row;
}

/**
 * Build the operational-conclusion pill as a DOM element.
 * @param {string} conclusion 'confirmed' | 'indicated_by_published_rules' | 'cannot_determine'
 * @param {{note?:string}} [options] `note` becomes the hover title (e.g. the sijui line).
 * @returns {HTMLElement} A `<span class="kilimo-pill">`.
 */
export function createConclusionPill(conclusion, options = {}) {
  const tone = CONCLUSION_TONES[String(conclusion)] || 'stale';
  const color = `var(${TRUTH_CSS_VARS[tone]}, ${TRUTH_COLORS[tone]})`;
  const pill = document.createElement('span');
  pill.className = `kilimo-pill kilimo-pill-${tone}`;
  pill.dataset.conclusion = String(conclusion || 'cannot_determine');
  pill.textContent = conclusionPillText(conclusion);
  if (options.note) pill.title = String(options.note);
  pill.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'padding:2px 9px',
    'border-radius:999px',
    'font-family:var(--font-mono, "JetBrains Mono", monospace)',
    'font-size:10px',
    'font-weight:600',
    'text-transform:uppercase',
    'letter-spacing:0.06em',
    `color:${color}`,
    `border:1px solid ${color}`,
    'background:rgba(4, 12, 16, 0.62)',
  ].join(';');
  return pill;
}

/**
 * Build the "SIMULATED" watermark badge for an HTML card.
 * @param {{label?:string}} [options]
 * @returns {HTMLElement}
 */
export function createSimulatedWatermark(options = {}) {
  const color = `var(--simulated, ${TRUTH_COLORS.simulated})`;
  const mark = document.createElement('span');
  mark.className = 'kilimo-watermark';
  mark.textContent = String(options.label || 'SIMULATED');
  mark.setAttribute('aria-label', 'Simulated demo data');
  mark.style.cssText = [
    'display:inline-block',
    'padding:1px 6px',
    'border-radius:3px',
    'font-family:var(--font-mono, "JetBrains Mono", monospace)',
    'font-size:9px',
    'font-weight:700',
    'letter-spacing:0.16em',
    `color:${color}`,
    `border:1px dashed ${color}`,
    'background:rgba(167, 139, 250, 0.10)',
  ].join(';');
  return mark;
}

// ── Canvas helpers ─────────────────────────────────────────────────────────

/**
 * Draw one evidence chip on a Canvas2D context, in the same visual language as
 * the DOM chip (mono text, 1 px tone border, dark plate).
 * @param {CanvasRenderingContext2D} ctx Target context.
 * @param {object|null} tag EvidenceTag.
 * @param {number} x Left edge in CSS pixels.
 * @param {number} y Top edge in CSS pixels.
 * @param {{alpha?:number, font?:string, padX?:number, height?:number, measureOnly?:boolean}} [options]
 * @returns {{width:number, height:number}} Laid-out chip box.
 */
export function drawEvidenceChip(ctx, tag, x, y, options = {}) {
  const parts = evidenceChipParts(tag);
  const font = options.font || EVIDENCE_CHIP_FONT;
  const padX = Number.isFinite(Number(options.padX)) ? Number(options.padX) : 4;
  const height = Number.isFinite(Number(options.height)) ? Number(options.height) : 13;
  ctx.save();
  ctx.font = font;
  const textWidth = ctx.measureText(parts.text).width;
  const width = Math.ceil(textWidth + padX * 2);
  if (options.measureOnly) {
    ctx.restore();
    return { width, height };
  }
  ctx.globalAlpha = Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 1;
  ctx.beginPath();
  roundedBox(ctx, x + 0.5, y + 0.5, width - 1, height - 1, 3);
  ctx.fillStyle = 'rgba(4, 12, 16, 0.72)';
  ctx.fill();
  ctx.strokeStyle = parts.color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = parts.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(parts.text, x + padX, y + height / 2 + 0.5);
  ctx.restore();
  return { width, height };
}

/**
 * Draw a horizontal run of chips, wrapping is NOT attempted: chips that would
 * exceed `maxWidth` are dropped and a `+n` counter is drawn instead, so a card
 * decoration can never grow without bound.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<object>} tags EvidenceTags.
 * @param {number} x Left edge.
 * @param {number} y Top edge.
 * @param {{maxWidth?:number, gap?:number, alpha?:number}} [options]
 * @returns {{width:number, height:number, drawn:number}}
 */
export function drawEvidenceChipRow(ctx, tags, x, y, options = {}) {
  const gap = Number.isFinite(Number(options.gap)) ? Number(options.gap) : 4;
  const maxWidth = Number.isFinite(Number(options.maxWidth))
    ? Number(options.maxWidth)
    : Number.POSITIVE_INFINITY;
  const list = Array.isArray(tags) ? tags : [];
  const seen = new Set();
  let cursor = x;
  let drawn = 0;
  let height = 0;
  for (const tag of list) {
    const text = evidenceChipText(tag);
    if (seen.has(text)) continue;
    seen.add(text);
    const box = drawEvidenceChip(ctx, tag, cursor, y, { ...options, measureOnly: true });
    if (cursor - x + box.width > maxWidth) break;
    drawEvidenceChip(ctx, tag, cursor, y, options);
    cursor += box.width + gap;
    height = Math.max(height, box.height);
    drawn += 1;
  }
  const remaining = seen.size - drawn;
  if (remaining > 0) {
    ctx.save();
    ctx.globalAlpha = Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 1;
    ctx.font = EVIDENCE_CHIP_FONT;
    ctx.fillStyle = WORLD_OVERLAY_STYLE.detail;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`+${remaining}`, cursor, y + (height || 13) / 2 + 0.5);
    ctx.restore();
  }
  return { width: cursor - x, height: height || 13, drawn };
}

/**
 * Draw the operational-conclusion pill on a canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} conclusion
 * @param {number} x Left edge.
 * @param {number} y Top edge.
 * @param {{alpha?:number, height?:number, measureOnly?:boolean}} [options]
 * @returns {{width:number, height:number}}
 */
export function drawConclusionPill(ctx, conclusion, x, y, options = {}) {
  const text = conclusionPillText(conclusion).toUpperCase();
  const color = conclusionColor(conclusion);
  const height = Number.isFinite(Number(options.height)) ? Number(options.height) : 15;
  ctx.save();
  ctx.font = CONCLUSION_PILL_FONT;
  const width = Math.ceil(ctx.measureText(text).width + 16);
  if (options.measureOnly) {
    ctx.restore();
    return { width, height };
  }
  ctx.globalAlpha = Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 1;
  ctx.beginPath();
  roundedBox(ctx, x + 0.5, y + 0.5, width - 1, height - 1, height / 2);
  ctx.fillStyle = 'rgba(4, 12, 16, 0.78)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 8, y + height / 2 + 0.5);
  ctx.restore();
  return { width, height };
}

/**
 * Stamp a diagonal "SIMULATED" watermark across a card rectangle.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number, y:number, w:number, h:number}} rect Card rectangle.
 * @param {{alpha?:number, label?:string}} [options]
 * @returns {void}
 */
export function drawSimulatedWatermark(ctx, rect, options = {}) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return;
  const label = String(options.label || 'SIMULATED');
  const alpha = Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 1;
  ctx.save();
  ctx.globalAlpha = 0.26 * alpha;
  ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.rotate(-Math.atan2(rect.h, rect.w * 1.6));
  ctx.font = SIMULATED_WATERMARK_FONT;
  ctx.fillStyle = TRUTH_COLORS.simulated;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 0);
  ctx.restore();
  // A thin violet frame, at full-ish alpha, so the classification survives
  // even when the diagonal text lands on busy imagery.
  ctx.save();
  ctx.globalAlpha = 0.55 * alpha;
  ctx.strokeStyle = TRUTH_COLORS.simulated;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  roundedBox(ctx, rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3, 4);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a pulsing ring, used to mark the selected depot/farmer anchor.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x Anchor x.
 * @param {number} y Anchor y.
 * @param {{timestamp?:number, color?:string, baseRadius?:number, alpha?:number}} [options]
 * @returns {void}
 */
export function drawPulseRing(ctx, x, y, options = {}) {
  const color = options.color || TRUTH_COLORS.official;
  const base = Number.isFinite(Number(options.baseRadius)) ? Number(options.baseRadius) : 9;
  const timestamp = Number.isFinite(Number(options.timestamp)) ? Number(options.timestamp) : 0;
  // 1.4 s period; deterministic in `timestamp`, so a recorded scene replays
  // the same frames.
  const phase = ((timestamp % 1400) / 1400);
  const radius = base + phase * base * 1.6;
  const alpha = (1 - phase) * (Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 1);
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha)) * 0.85;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Rounded-rectangle path helper (local, so this module has no dependency on
 * the overlay draw internals).
 * @param {CanvasRenderingContext2D|Path2D} path
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} radius
 * @returns {void}
 */
function roundedBox(path, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  path.moveTo(x + r, y);
  path.lineTo(x + w - r, y);
  path.arcTo(x + w, y, x + w, y + r, r);
  path.lineTo(x + w, y + h - r);
  path.arcTo(x + w, y + h, x + w - r, y + h, r);
  path.lineTo(x + r, y + h);
  path.arcTo(x, y + h, x, y + h - r, r);
  path.lineTo(x, y + r);
  path.arcTo(x, y, x + r, y, r);
}

// ── World-overlay decoration lane ──────────────────────────────────────────

/**
 * Decorations, keyed `sourceId::entryId`. A layer registers what a card must
 * carry; the lane painter finds where that card landed this frame and draws
 * the chips / watermark / pulse over it.
 * @type {Map<string, {sourceId:string, entryId:string, tags:object[], simulated:boolean, conclusion:string|null, pulse:boolean, pulseColor:string|null}>}
 */
const _decorations = new Map();
let _laneHandle = null;

/**
 * Register (or replace) the evidence decoration for one overlay entry.
 * @param {string} sourceId Overlay source id (the layer's overlay source).
 * @param {string} entryId Overlay entry id.
 * @param {{tags?:object[], simulated?:boolean, conclusion?:string|null, pulse?:boolean, pulseColor?:string|null}} decoration
 * @returns {void}
 */
export function setEvidenceDecoration(sourceId, entryId, decoration = {}) {
  if (!sourceId || !entryId) return;
  _decorations.set(`${sourceId}::${entryId}`, {
    sourceId: String(sourceId),
    entryId: String(entryId),
    tags: Array.isArray(decoration.tags) ? decoration.tags.filter(Boolean) : [],
    simulated: decoration.simulated === true,
    conclusion: decoration.conclusion ? String(decoration.conclusion) : null,
    pulse: decoration.pulse === true,
    pulseColor: decoration.pulseColor || null,
  });
  _laneHandle?.setActive(true);
  _laneHandle?.requestPaint();
}

/**
 * Drop every decoration owned by one overlay source (call on layer disable).
 * @param {string} sourceId
 * @returns {void}
 */
export function clearEvidenceDecorations(sourceId) {
  const prefix = `${sourceId}::`;
  for (const key of [..._decorations.keys()]) {
    if (key.startsWith(prefix)) _decorations.delete(key);
  }
  _laneHandle?.requestPaint();
}

/** @returns {number} Live decoration count (diagnostics/tests). */
export function evidenceDecorationCount() {
  return _decorations.size;
}

/**
 * Install the custom paint lane that decorates Kilimo overlay cards with
 * coloured evidence chips, conclusion pills, SIMULATED watermarks and the
 * selected-anchor pulse.
 *
 * Idempotent: repeated calls return the same handle. Registered on the
 * 'tracked' lane because custom painters run FIRST inside their own lane —
 * only a later lane can see (via `getOverlayPaintRect`) where the cards from
 * the ambient-card and selected lanes were painted this frame.
 *
 * @returns {{unregister:function():void}} Handle; `unregister()` removes the lane.
 */
export function installEvidenceOverlayLane() {
  if (_laneHandle) return _laneHandle;
  _laneHandle = registerWorldOverlayPaintLane('tracked', paintEvidenceLane, {
    id: 'kilimo-evidence',
    active: true,
    target: 'shared',
    shouldPaint: () => _decorations.size > 0,
  });
  return _laneHandle;
}

/** Remove the lane and every decoration (teardown / tests). */
export function uninstallEvidenceOverlayLane() {
  _decorations.clear();
  if (_laneHandle) {
    _laneHandle.unregister();
    _laneHandle = null;
  }
}

/**
 * The lane painter. Never clears or resizes the host surface; only draws
 * inside/below rectangles the host published this frame.
 * @param {{ctx:CanvasRenderingContext2D, timestamp:number, height:number}} frame
 * @returns {void}
 */
function paintEvidenceLane(frame) {
  const ctx = frame?.ctx;
  if (!ctx) return;
  for (const decoration of _decorations.values()) {
    const rect = getOverlayPaintRect(decoration.sourceId, decoration.entryId);
    if (!rect) continue; // not painted this frame (culled, decluttered, hidden)
    if (decoration.simulated) {
      drawSimulatedWatermark(ctx, rect, { alpha: 1 });
    }
    let cursorY = rect.y + rect.h + 3;
    if (decoration.conclusion) {
      const pill = drawConclusionPill(ctx, decoration.conclusion, rect.x, cursorY, {});
      cursorY += pill.height + 3;
    }
    if (decoration.tags.length) {
      drawEvidenceChipRow(ctx, decoration.tags, rect.x, cursorY, {
        maxWidth: Math.max(120, rect.w * 2.2),
      });
    }
    if (decoration.pulse) {
      // The published rect carries no anchor point, so the ring is drawn at the
      // card's bottom-centre — where the leader meets the card — which reads as
      // a halo on the selected marker below it.
      drawPulseRing(ctx, rect.x + rect.w / 2, rect.y + rect.h, {
        timestamp: frame.timestamp,
        color: decoration.pulseColor || TRUTH_COLORS.official,
      });
    }
  }
}
