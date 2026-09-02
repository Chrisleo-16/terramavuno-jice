/**
 * resultCard.js — renders a deterministic-engine Decision
 * (packages/shared/src/eligibility/types.ts) into #kilimo-result-card.
 *
 * Visual language comes from apps/globe/style.css ONLY: .glass-surface,
 * .conclusion-pill (+ .conclusion-confirmed | .conclusion-indicated |
 * .conclusion-cannot-determine), .evidence-chip (+ .authority-* /
 * .derivation-* / .freshness-*) and .simulated-watermark. No new visual
 * language is invented here; small layout-only inline styles are used because
 * this agent does not own style.css.
 *
 * The engine decides; this module only displays and cites.
 */

const MOUNT_ID = 'kilimo-result-card';

/** Escape text for innerHTML. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CONCLUSION_META = {
  confirmed: { cls: 'conclusion-confirmed', label: 'Confirmed' },
  indicated_by_published_rules: { cls: 'conclusion-indicated', label: 'Indicated by published rules' },
  cannot_determine: { cls: 'conclusion-cannot-determine', label: 'Cannot determine' },
};

const RESULT_ICON = { pass: '✓', fail: '✕', unknown: '?' };
const RESULT_COLOR = {
  pass: 'var(--official)',
  fail: 'var(--stale)',
  unknown: 'var(--text-dim)',
};

const LABEL_STYLE =
  'font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:var(--text-dim);margin:14px 0 6px;';
const ROW_STYLE =
  'display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--glass-border);';

/** Format an ISO timestamp for display, or an honest placeholder. */
function fmtTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function fmtKes(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? `KES ${value.toLocaleString('en-KE')}`
    : '—';
}

/** The three chips of one EvidenceTag. */
function evidenceChips(evidence) {
  if (!evidence) return '';
  const authority = evidence.authority ? String(evidence.authority) : null;
  const derivation = evidence.derivation ? String(evidence.derivation) : null;
  const freshness = evidence.freshness?.status ? String(evidence.freshness.status) : null;
  const checkedAt = fmtTime(evidence.freshness?.checkedAt);
  const parts = [];
  if (authority) {
    parts.push(
      `<span class="evidence-chip authority-${esc(authority)}" title="Authority">${esc(authority)}</span>`,
    );
  }
  if (derivation) {
    parts.push(
      `<span class="evidence-chip derivation-${esc(derivation)}" title="Derivation">${esc(derivation)}</span>`,
    );
  }
  if (freshness) {
    parts.push(
      `<span class="evidence-chip freshness-${esc(freshness)}" title="Freshness${
        checkedAt ? ` — checked ${esc(checkedAt)}` : ' — never checked'
      }">${esc(checkedAt ? freshness : `${freshness} · not verified`)}</span>`,
    );
  }
  return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">${parts.join('')}</div>`;
}

/** True when any evidence tag / depot / trace row in the decision is simulated. */
export function decisionIsSimulated(decision) {
  if (!decision) return false;
  if (decision.depot?.classification === 'simulated') return true;
  const tags = [...(decision.citations ?? []), ...(decision.trace ?? []).map((t) => t?.evidence)];
  return tags.some((tag) => tag && (tag.derivation === 'simulated' || tag.authority === 'reported'));
}

/** Plain-text version of the card — used by copy-to-clipboard and WhatsApp share. */
export function decisionToText(decision) {
  const meta = CONCLUSION_META[decision?.conclusion] ?? { label: decision?.conclusion ?? 'unknown' };
  const lines = [
    'Nielekeze by TerraMavuno',
    `Farmer ${decision?.farmerToken ?? '—'} · ${decision?.wardName ?? '—'} ward, Kandara, Murang'a`,
    `Conclusion: ${meta.label}`,
    `Eligible: ${decision?.eligible === true ? 'YES' : decision?.eligible === false ? 'NO' : 'cannot determine'}`,
  ];
  if (decision?.missingRequirement) lines.push(`Missing requirement: ${decision.missingRequirement}`);
  if (typeof decision?.allocationBags === 'number') {
    lines.push(`Allocation: ${decision.allocationBags} bags (50 kg each)`);
  }
  if (typeof decision?.pricePerBagKes === 'number') {
    lines.push(
      `Price: ${fmtKes(decision.pricePerBagKes)}/bag subsidized vs ${fmtKes(decision.marketPriceKes)}/bag market` +
        (typeof decision.savingsKes === 'number' ? ` — you save ${fmtKes(decision.savingsKes)}` : ''),
    );
  }
  if (decision?.depot) {
    const checked = fmtTime(decision.depot.stock?.checkedAt);
    lines.push(
      `Collection point: ${decision.depot.name} — stock ${decision.depot.stock?.status ?? 'unknown'}` +
        (checked ? `, checked ${checked}` : ', stock not verified'),
    );
  }
  lines.push('');
  lines.push('Criteria:');
  for (const row of decision?.trace ?? []) {
    lines.push(
      `  [${(RESULT_ICON[row?.result] ?? '?')}] ${row?.label ?? row?.criterionId} — observed: ${formatObserved(row?.observed)} (${row?.evidence?.authority ?? '?'}/${row?.evidence?.derivation ?? '?'})`,
    );
  }
  if (decision?.sijui) {
    lines.push('');
    lines.push(`Sijui: ${decision.sijui}`);
  }
  lines.push('');
  lines.push(`Next action: ${decision?.nextAction ?? '—'}`);
  lines.push(`Evaluated at: ${fmtTime(decision?.evaluatedAt) ?? '—'}`);
  if (decisionIsSimulated(decision)) {
    lines.push('NOTE: this decision uses SIMULATED demo data — not an official determination.');
  }
  return lines.join('\n');
}

function formatObserved(observed) {
  if (observed === null || observed === undefined) return 'unknown';
  if (typeof observed === 'boolean') return observed ? 'yes' : 'no';
  if (typeof observed === 'object') {
    try {
      return JSON.stringify(observed);
    } catch {
      return String(observed);
    }
  }
  return String(observed);
}

/** Cached share availability probe (GET /api/share/health). */
let sharePromise = null;
function shareAvailable() {
  if (!sharePromise) {
    sharePromise = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('/api/share/health', { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return false;
        const body = await res.json().catch(() => null);
        // Defensive: sibling may report { available } or { ok } or { status:'ok' }.
        return Boolean(body?.available ?? body?.ok ?? body?.status === 'ok');
      } catch {
        return false;
      }
    })();
  }
  return sharePromise;
}

function getMount() {
  const mount = document.getElementById(MOUNT_ID);
  if (!mount) console.warn(`[Kilimo] #${MOUNT_ID} is missing — the result card cannot render.`);
  return mount;
}

/** Hide and empty the card. */
export function hideResultCard() {
  const mount = getMount();
  if (!mount) return;
  mount.innerHTML = '';
  mount.hidden = true;
}

/** The Decision most recently rendered (voice + chat share one card). */
let currentDecision = null;
export function getCurrentDecision() {
  return currentDecision;
}

/**
 * showResultCard — render a Decision into #kilimo-result-card.
 * @param {object} decision Decision from the deterministic engine.
 * @returns {boolean} true when rendered.
 */
export function showResultCard(decision) {
  const mount = getMount();
  if (!mount) return false;
  if (!decision || typeof decision !== 'object' || !decision.conclusion) {
    console.warn('[Kilimo] showResultCard called without a Decision object');
    return false;
  }
  currentDecision = decision;

  const meta = CONCLUSION_META[decision.conclusion] ?? {
    cls: 'conclusion-cannot-determine',
    label: String(decision.conclusion),
  };
  const simulated = decisionIsSimulated(decision);
  const depot = decision.depot;
  const depotChecked = fmtTime(depot?.stock?.checkedAt);

  const traceRows = (decision.trace ?? [])
    .map((row) => {
      const result = RESULT_ICON[row?.result] ? row.result : 'unknown';
      return `
        <div style="${ROW_STYLE}">
          <span aria-hidden="true" style="color:${RESULT_COLOR[result]};font-weight:700;width:14px;flex:none;">${RESULT_ICON[result]}</span>
          <span style="flex:1;min-width:0;">
            <span style="font-size:11px;color:var(--text-primary);">${esc(row?.label ?? row?.criterionId ?? 'criterion')}</span>
            <span style="display:block;font-size:10px;color:var(--text-secondary);">observed: ${esc(formatObserved(row?.observed))}<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;"> (${esc(result)})</span></span>
            ${evidenceChips(row?.evidence)}
          </span>
        </div>`;
    })
    .join('');

  const priceBlock =
    typeof decision.pricePerBagKes === 'number'
      ? `
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;">
        <span style="font-size:18px;font-weight:700;color:var(--accent);">${esc(fmtKes(decision.pricePerBagKes))}<span style="font-size:10px;color:var(--text-dim);">/bag subsidized</span></span>
        <span style="font-size:12px;color:var(--text-secondary);text-decoration:line-through;">${esc(fmtKes(decision.marketPriceKes))}/bag market</span>
        ${
          typeof decision.savingsKes === 'number'
            ? `<span style="font-size:11px;color:var(--official);">you save ${esc(fmtKes(decision.savingsKes))}</span>`
            : ''
        }
      </div>`
      : '<div style="font-size:11px;color:var(--text-dim);">No price applies to this decision.</div>';

  mount.innerHTML = `
    ${simulated ? '<span class="simulated-watermark" title="This decision uses simulated demo inputs">SIMULATED</span>' : ''}
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span class="conclusion-pill ${meta.cls}">${esc(meta.label)}</span>
      <button type="button" data-kilimo-card="close" aria-label="Close result card"
        style="margin-left:auto;background:none;border:none;color:var(--text-dim);font-size:14px;cursor:pointer;line-height:1;">✕</button>
    </div>

    <div style="margin-top:12px;">
      <div style="font-size:15px;font-weight:700;letter-spacing:0.04em;">Farmer ${esc(decision.farmerToken ?? '—')}</div>
      <div style="font-size:11px;color:var(--text-secondary);">${esc(decision.wardName ?? '—')} ward · Kandara · Murang'a County</div>
    </div>

    ${
      decision.eligible === false && decision.missingRequirement
        ? `<div style="margin-top:12px;padding:8px 10px;border-radius:8px;border:1px solid rgba(248,113,113,0.35);background:rgba(248,113,113,0.08);font-size:11px;color:var(--stale);">
             Missing requirement: <strong>${esc(decision.missingRequirement)}</strong>
           </div>`
        : ''
    }

    ${
      decision.sijui
        ? `<div role="note" aria-label="Honest uncertainty" style="margin-top:12px;padding:10px 12px;border-radius:8px;border:1px dashed rgba(245,185,66,0.55);background:rgba(245,185,66,0.08);">
             <div style="font-size:9px;letter-spacing:0.2em;color:var(--reported);margin-bottom:4px;">SIJUI — HONEST UNCERTAINTY</div>
             <div style="font-size:12px;color:var(--text-primary);">${esc(decision.sijui)}</div>
           </div>`
        : ''
    }

    <div style="${LABEL_STYLE}">Allocation &amp; price</div>
    <div style="font-size:12px;color:var(--text-primary);margin-bottom:6px;">
      ${
        typeof decision.allocationBags === 'number'
          ? `<strong>${esc(decision.allocationBags)}</strong> bags &times; 50 kg`
          : 'No allocation'
      }
    </div>
    ${priceBlock}

    <div style="${LABEL_STYLE}">Where to go</div>
    ${
      depot
        ? `<div style="font-size:12px;">${esc(depot.name)}
             <span style="display:block;font-size:10px;color:var(--text-secondary);">
               stock: ${esc(depot.stock?.status ?? 'unknown')} · ${
                 depotChecked ? `checked ${esc(depotChecked)}` : '<strong>stock not verified</strong>'
               } · ${esc(depot.classification ?? 'unknown')}
             </span>
           </div>`
        : '<div style="font-size:11px;color:var(--text-dim);">No collection point assigned.</div>'
    }

    <div style="${LABEL_STYLE}">Criteria trace</div>
    ${traceRows || '<div style="font-size:11px;color:var(--text-dim);">No criteria evaluated.</div>'}

    <div style="margin-top:16px;padding:12px 14px;border-radius:10px;border:1px solid var(--glass-border);background:rgba(52,209,123,0.08);">
      <div style="font-size:9px;letter-spacing:0.2em;color:var(--accent);margin-bottom:4px;">NEXT ACTION</div>
      <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${esc(decision.nextAction ?? '—')}</div>
    </div>

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center;">
      <button type="button" data-kilimo-card="copy"
        style="padding:6px 12px;border-radius:999px;border:1px solid var(--glass-border);background:transparent;color:var(--text-primary);font-family:var(--font-mono);font-size:10px;letter-spacing:0.12em;cursor:pointer;">COPY</button>
      <button type="button" data-kilimo-card="whatsapp" hidden
        style="padding:6px 12px;border-radius:999px;border:1px solid rgba(52,209,123,0.45);background:rgba(52,209,123,0.12);color:var(--accent);font-family:var(--font-mono);font-size:10px;letter-spacing:0.12em;cursor:pointer;">SHARE VIA WHATSAPP</button>
      <span data-kilimo-card="status" role="status" aria-live="polite" style="font-size:10px;color:var(--text-dim);"></span>
    </div>

    <div style="margin-top:10px;font-size:9px;color:var(--text-dim);letter-spacing:0.08em;">
      Evaluated at ${esc(fmtTime(decision.evaluatedAt) ?? 'unknown')}${
        decision.dataMode ? ` · data: ${esc(decision.dataMode)}` : ''
      }
    </div>
  `;
  mount.hidden = false;

  const status = mount.querySelector('[data-kilimo-card="status"]');
  const setStatus = (text) => {
    if (status) status.textContent = text;
  };
  const text = decisionToText(decision);

  mount.querySelector('[data-kilimo-card="close"]')?.addEventListener('click', hideResultCard);

  mount.querySelector('[data-kilimo-card="copy"]')?.addEventListener('click', async () => {
    const copied = await copyText(text);
    setStatus(copied ? 'copied to clipboard' : 'copy failed — text selected instead');
  });

  const waButton = mount.querySelector('[data-kilimo-card="whatsapp"]');
  if (waButton) {
    waButton.addEventListener('click', async () => {
      setStatus('sharing…');
      try {
        const res = await fetch('/api/share/whatsapp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, text }),
        });
        if (!res.ok) throw new Error(`share failed (${res.status})`);
        setStatus('sent to WhatsApp');
      } catch {
        // Zero-risk fallback: the wa.me deep link with the formatted text.
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        setStatus('opened WhatsApp deep link');
      }
    });
    // Hidden unless the API reports share is available.
    void shareAvailable().then((available) => {
      if (document.body.contains(waButton)) waButton.hidden = !available;
    });
  }

  return true;
}

/** Clipboard with a selection fallback that always works. */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy');
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
}
