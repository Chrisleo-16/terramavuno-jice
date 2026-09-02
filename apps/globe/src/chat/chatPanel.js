/**
 * chatPanel.js — the glass chat panel mounted into #kilimo-chat-panel.
 *
 * Visuals come from style.css (.glass-surface on the mount, .evidence-chip /
 * .conclusion-pill for facts); only layout-level inline styles are added here
 * because this agent does not own style.css.
 *
 * Behaviour:
 *  - message list (user / assistant) with streaming assistant text
 *  - a subtle "calling evaluate_farmer…" tool indicator
 *  - textarea input, Enter sends, Shift+Enter newlines
 *  - four one-click suggested prompts that drive the demo
 *  - listens for the layers' `kilimo:farmer-selected` CustomEvent and asks the
 *    matching question, so clicking a farmer on the globe starts the chat
 *  - keyboard events are NOT allowed to reach the globe's key handlers while
 *    typing (stopPropagation on the input only — the globe keeps its own keys
 *    everywhere else)
 *  - DEMO INSURANCE: when /api/chat is unreachable the panel says
 *    "chat unavailable — the map still works" and the suggested prompts call
 *    POST /api/evaluate directly and render the result card.
 */

const MOUNT_ID = 'kilimo-chat-panel';

export const SUGGESTED_PROMPTS = Object.freeze([
  { label: "K-001 — will I get fertilizer?", text: "I'm farmer K-001 in Ng'araria — will I get subsidized fertilizer?", token: 'K-001' },
  { label: 'What will I pay?', text: 'What will I pay and where do I go?', token: null },
  { label: 'Check K-002', text: 'Check farmer K-002', token: 'K-002' },
  { label: 'Check K-004', text: 'Check farmer K-004', token: 'K-004' },
]);

const OFFLINE_MESSAGE = 'chat unavailable — the map still works';

/** Extract a farmer token (K-001 style) from free text. */
export function extractToken(text) {
  const match = /\bK-?0*(\d{1,3})\b/i.exec(String(text ?? ''));
  return match ? `K-${match[1].padStart(3, '0')}` : null;
}

/**
 * Mount the chat panel.
 *
 * @param {object} deps
 * @param {ReturnType<import('./chatClient.js').createChatClient>} deps.chatClient
 * @param {(decision: object) => void} [deps.showResultCard]
 * @returns {{ askQuestion:(text:string)=>void, setOffline:(offline:boolean)=>void, destroy:()=>void, element:HTMLElement|null }}
 */
export function mountChatPanel({ chatClient, showResultCard } = {}) {
  const mount = document.getElementById(MOUNT_ID);
  if (!mount) {
    console.warn(`[Kilimo] #${MOUNT_ID} is missing — the chat panel cannot mount.`);
    return { askQuestion: () => {}, setOffline: () => {}, destroy: () => {}, element: null };
  }

  let offline = false;
  /** Last token mentioned, so "what will I pay?" has a subject in fallback mode. */
  let lastToken = 'K-001';

  mount.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--glass-border);flex:none;">
      <span style="font-size:10px;letter-spacing:0.22em;color:var(--accent);">KILIMO, NITAPATA?</span>
      <span data-chat="state" role="status" aria-live="polite" style="margin-left:auto;font-size:9px;letter-spacing:0.14em;color:var(--text-dim);"></span>
    </div>

    <div data-chat="log" role="log" aria-live="polite" aria-label="Conversation"
      tabindex="0"
      style="flex:1;min-height:120px;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-size:12px;line-height:1.5;"></div>

    <div data-chat="tool" hidden aria-live="polite"
      style="padding:0 14px 8px;font-size:10px;letter-spacing:0.08em;color:var(--accent-alt);"></div>

    <div style="padding:0 14px 10px;display:flex;flex-wrap:wrap;gap:6px;flex:none;" data-chat="suggestions"></div>

    <form data-chat="form" style="display:flex;gap:8px;align-items:flex-end;padding:10px 14px 12px;border-top:1px solid var(--glass-border);flex:none;">
      <label for="kilimo-chat-input" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;">Ask the Kilimo assistant</label>
      <textarea id="kilimo-chat-input" data-chat="input" rows="1" placeholder="Uliza… e.g. Nina mbolea ya ruzuku?"
        style="flex:1;resize:none;max-height:88px;background:rgba(255,255,255,0.04);border:1px solid var(--glass-border);border-radius:10px;padding:8px 10px;color:var(--text-primary);font-family:var(--font-mono);font-size:12px;"></textarea>
      <button type="submit" data-chat="send"
        style="padding:8px 14px;border-radius:999px;border:1px solid rgba(52,209,123,0.45);background:rgba(52,209,123,0.12);color:var(--accent);font-family:var(--font-mono);font-size:10px;letter-spacing:0.14em;cursor:pointer;">SEND</button>
    </form>
  `;

  const log = mount.querySelector('[data-chat="log"]');
  const stateEl = mount.querySelector('[data-chat="state"]');
  const toolEl = mount.querySelector('[data-chat="tool"]');
  const form = mount.querySelector('[data-chat="form"]');
  const input = mount.querySelector('[data-chat="input"]');
  const sendButton = mount.querySelector('[data-chat="send"]');
  const suggestions = mount.querySelector('[data-chat="suggestions"]');

  const setState = (text) => {
    if (stateEl) stateEl.textContent = text ?? '';
  };
  const setTool = (name) => {
    if (!toolEl) return;
    if (!name) {
      toolEl.hidden = true;
      toolEl.textContent = '';
      return;
    }
    toolEl.hidden = false;
    toolEl.textContent = `calling ${name}…`;
  };

  const scroll = () => {
    if (log) log.scrollTop = log.scrollHeight;
  };

  /** Append a message bubble; returns the text node holder for streaming. */
  function addMessage(role, text) {
    const wrap = document.createElement('div');
    const isUser = role === 'user';
    const isSystem = role === 'system';
    wrap.style.cssText = [
      'max-width:92%',
      `align-self:${isUser ? 'flex-end' : 'flex-start'}`,
      'padding:8px 11px',
      'border-radius:12px',
      `border:1px solid ${isSystem ? 'rgba(248,113,113,0.4)' : 'var(--glass-border)'}`,
      `background:${isUser ? 'rgba(52,209,123,0.12)' : isSystem ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.04)'}`,
      `color:${isSystem ? 'var(--stale)' : 'var(--text-primary)'}`,
      'white-space:pre-wrap',
      'word-break:break-word',
    ].join(';');
    wrap.dataset.role = role;
    wrap.textContent = text ?? '';
    log?.appendChild(wrap);
    scroll();
    return wrap;
  }

  /** Send through Claude, or fall back to the engine when the API is down. */
  async function ask(text, { forceToken = null } = {}) {
    const question = String(text ?? '').trim();
    if (!question) return;
    const token = forceToken ?? extractToken(question);
    if (token) lastToken = token;

    addMessage('user', question);
    if (input) input.value = '';

    if (offline) {
      await runFallback(token ?? lastToken);
      return;
    }

    setState('thinking…');
    if (sendButton) sendButton.disabled = true;
    const bubble = addMessage('assistant', '');
    let gotText = false;

    const result = await chatClient.send(question, {
      onDelta: (_chunk, full) => {
        gotText = true;
        bubble.textContent = full;
        scroll();
      },
      onToolStart: (name) => setTool(name),
      onError: (message) => {
        setTool(null);
        if (!gotText) bubble.remove();
        addMessage('system', message);
        if (message === OFFLINE_MESSAGE) setOffline(true);
      },
      onDone: () => {
        setTool(null);
        setState('');
      },
    });

    if (sendButton) sendButton.disabled = false;
    setTool(null);
    setState('');
    if (!result?.ok && !gotText) {
      // Insurance: answer the core journey without Claude.
      await runFallback(token ?? lastToken);
    }
  }

  /** No-Claude path: deterministic engine + result card. */
  async function runFallback(token) {
    const target = token || lastToken;
    setState('engine only');
    const bubble = addMessage(
      'assistant',
      `Claude is unavailable, so I ran the deterministic engine directly for ${target}…`,
    );
    try {
      const decision = await chatClient.evaluateDirect(target);
      if (!decision?.conclusion) throw new Error('no decision returned');
      const verdict =
        decision.conclusion === 'confirmed'
          ? decision.eligible
            ? 'Confirmed — you qualify.'
            : `Confirmed — you do not qualify: ${decision.missingRequirement ?? 'a requirement is not met'}.`
          : decision.conclusion === 'indicated_by_published_rules'
            ? 'Indicated by published rules.'
            : 'Cannot determine.';
      const lines = [
        `${target} · ${decision.wardName ?? 'ward unknown'} — ${verdict}`,
        typeof decision.allocationBags === 'number' ? `Allocation: ${decision.allocationBags} bags (50 kg).` : null,
        typeof decision.pricePerBagKes === 'number'
          ? `Price: KES ${decision.pricePerBagKes.toLocaleString('en-KE')}/bag subsidized vs KES ${Number(decision.marketPriceKes ?? 0).toLocaleString('en-KE')}/bag market.`
          : null,
        decision.depot ? `Go to: ${decision.depot.name}.` : null,
        decision.sijui,
        `Next action: ${decision.nextAction ?? '—'}`,
      ].filter(Boolean);
      bubble.textContent = lines.join('\n');
      showResultCard?.(decision);
    } catch {
      bubble.remove();
      addMessage('system', 'the eligibility engine is unreachable too — the map layers still work offline');
    } finally {
      setState(offline ? OFFLINE_MESSAGE : '');
    }
  }

  /** Toggle the offline banner + fallback mode. */
  function setOffline(next) {
    const changed = offline !== Boolean(next);
    offline = Boolean(next);
    if (input) input.placeholder = offline ? 'chat unavailable — try a suggested prompt' : 'Uliza… e.g. Nina mbolea ya ruzuku?';
    setState(offline ? OFFLINE_MESSAGE : '');
    if (changed && offline) addMessage('system', OFFLINE_MESSAGE);
  }

  // Suggested prompts.
  for (const prompt of SUGGESTED_PROMPTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = prompt.label;
    button.title = prompt.text;
    button.style.cssText =
      'padding:5px 10px;border-radius:999px;border:1px solid var(--glass-border);background:rgba(255,255,255,0.04);color:var(--text-secondary);font-family:var(--font-mono);font-size:9.5px;letter-spacing:0.08em;cursor:pointer;';
    button.addEventListener('click', () => {
      void ask(prompt.text, { forceToken: prompt.token });
    });
    suggestions?.appendChild(button);
  }

  // Input handling — Enter sends, Shift+Enter newlines.
  const onKeyDown = (event) => {
    // Do not let typing reach the globe's global key handlers.
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void ask(input.value);
    }
  };
  input?.addEventListener('keydown', onKeyDown);
  input?.addEventListener('keyup', (event) => event.stopPropagation());
  input?.addEventListener('keypress', (event) => event.stopPropagation());
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(88, input.scrollHeight)}px`;
  });

  const onSubmit = (event) => {
    event.preventDefault();
    void ask(input?.value);
  };
  form?.addEventListener('submit', onSubmit);

  // Clicking a farmer marker on the globe starts the conversation.
  const onFarmerSelected = (event) => {
    const detail = event?.detail ?? {};
    // Defensive: the layers agent may emit { token } | { farmer:{token} } | a string.
    const token =
      extractToken(detail.token ?? detail.farmerToken ?? detail.farmer?.token ?? detail.id ?? detail) ?? null;
    const ward = detail.wardName ?? detail.ward ?? detail.farmer?.wardName ?? null;
    if (!token) return;
    const question = ward
      ? `I'm farmer ${token} in ${ward} — will I get subsidized fertilizer?`
      : `Check farmer ${token}`;
    if (input) input.value = question;
    void ask(question, { forceToken: token });
  };
  window.addEventListener('kilimo:farmer-selected', onFarmerSelected);
  document.addEventListener('kilimo:farmer-selected', onFarmerSelected);

  addMessage(
    'assistant',
    "Karibu. Ask about the 2026 fertilizer subsidy — the engine decides, I explain and cite. Try a farmer token like K-001.",
  );

  // Probe the API once so the offline banner appears before the first send.
  void chatClient
    .probe?.()
    .then((up) => {
      if (up === false) setOffline(true);
    })
    .catch(() => {});

  return {
    askQuestion: (text) => void ask(text),
    setOffline,
    element: mount,
    destroy() {
      window.removeEventListener('kilimo:farmer-selected', onFarmerSelected);
      document.removeEventListener('kilimo:farmer-selected', onFarmerSelected);
      form?.removeEventListener('submit', onSubmit);
      input?.removeEventListener('keydown', onKeyDown);
      mount.innerHTML = '';
    },
  };
}
