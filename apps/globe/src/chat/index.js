/**
 * chat/index.js — the ONE wire-up entry point for the whole interaction layer
 * (action runner + Claude chat panel + result card + ElevenLabs voice).
 *
 * This agent does not own main.js, so integration is a single line there:
 *
 *   import { initKilimoInteraction } from CHAT_INDEX  // = ./chat/index.js
 *   void initKilimoInteraction();
 *
 * (written without a literal import path so the repo import audit does not
 * treat this comment as a real edge)
 *
 * It is safe to call before or after main.js publishes window.__KILIMO__:
 * the module waits for the handle (polling ~100 ms up to 20 s, and also
 * listening for a `kilimo:ready` event if main.js ever dispatches one), and it
 * is idempotent — repeat calls return the same instance.
 */

import { createMavunoActionRunner } from '../actions/mavunoActions.js';
import { createChatClient } from './chatClient.js';
import { mountChatPanel } from './chatPanel.js';
import { showResultCard, hideResultCard } from '../farmerCard/resultCard.js';
import { initVoice } from '../voice/voiceClient.js';

const HANDLE_POLL_MS = 100;
const HANDLE_TIMEOUT_MS = 20000;

/** Resolve window.__KILIMO__, waiting for main.js if we ran first. */
export function waitForKilimoHandle({ timeoutMs = HANDLE_TIMEOUT_MS } = {}) {
  if (window.__KILIMO__?.viewer) return Promise.resolve(window.__KILIMO__);
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const finish = (handle) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      window.removeEventListener('kilimo:ready', onReady);
      resolve(handle);
    };
    const onReady = () => {
      if (window.__KILIMO__?.viewer) finish(window.__KILIMO__);
    };
    window.addEventListener('kilimo:ready', onReady);
    const timer = setInterval(() => {
      if (window.__KILIMO__?.viewer) finish(window.__KILIMO__);
      else if (Date.now() - started > timeoutMs) finish(null);
    }, HANDLE_POLL_MS);
  });
}

/**
 * Find the layers' target resolver wherever the layers agent exposed it:
 * on the handle, on a kilimoLayers namespace, or on the wards/depots layer
 * modules themselves. Returns undefined when there is none (the runner then
 * uses its built-in gazetteer).
 */
function findResolveTarget(handle) {
  const candidates = [
    handle?.resolveTarget,
    handle?.kilimo?.resolveTarget,
    handle?.kilimoLayers?.resolveTarget,
    window.__KILIMO_LAYERS__?.resolveTarget,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'function') return (target) => candidate(target);
  }
  const registry = handle?.layerRegistry;
  const modules = registry?.values ? Array.from(registry.values()) : Object.values(registry ?? {});
  const withResolver = modules.filter((m) => typeof m?.resolveTarget === 'function');
  if (withResolver.length === 0) return undefined;
  return async (target) => {
    for (const module of withResolver) {
      try {
        const hit = await module.resolveTarget(target);
        if (hit) return hit;
      } catch {
        /* try the next layer */
      }
    }
    return null;
  };
}

let instance = null;

/**
 * initKilimoInteraction — build the runner, mount the chat panel + result
 * card, and initialise voice.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs] How long to wait for window.__KILIMO__.
 * @returns {Promise<{ runAction:Function, chatClient:object, chatPanel:object,
 *   showResultCard:Function, hideResultCard:Function, voice:object }|null>}
 */
export async function initKilimoInteraction(options = {}) {
  if (instance) return instance;

  const handle = await waitForKilimoHandle(options);
  if (!handle) {
    console.warn('[Kilimo] window.__KILIMO__ never appeared — interaction layer not mounted.');
    return null;
  }

  const runAction = createMavunoActionRunner({
    viewer: handle.viewer,
    layerRegistry: handle.layerRegistry,
    resolveTarget: findResolveTarget(handle),
    showResultCard,
  });

  const chatClient = createChatClient({ runAction });
  const chatPanel = mountChatPanel({ chatClient, showResultCard });

  // Voice is a flourish: never let its failure block chat.
  const voice = await initVoice({ runAction, showResultCard }).catch((error) => ({
    available: false,
    reason: String(error?.message ?? error),
  }));

  instance = { runAction, chatClient, chatPanel, showResultCard, hideResultCard, voice };
  // Published for debugging and for the voice/layer agents to reuse.
  handle.interaction = instance;
  window.dispatchEvent(new CustomEvent('kilimo:interaction-ready', { detail: instance }));
  return instance;
}

export { showResultCard, hideResultCard, createMavunoActionRunner, createChatClient, mountChatPanel, initVoice };
export default initKilimoInteraction;
