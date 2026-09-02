# GEV action-runner contract (ported from `src/voice/gevActions.js` + `gevRealtime.js`)

The GEV voice modules were deleted from this fork (OpenAI Realtime is replaced by
Claude chat + ElevenLabs voice), but their **runner contract** is the blueprint for
`src/actions/mavunoActions.js`. Source: God's Eye View (MIT),
https://github.com/bilawalsidhu/gods-eye-view — see
`references/gods-eye-view/src/voice/gevActions.js` and `gevRealtime.js`.

## Runner signature

```js
// gevActions.js:293 — the factory returns this closure:
async function runGevAction(name, rawArgs = {}, runOptions = {}) { ... }
// runOptions: { signal?: AbortSignal, isCurrent?: () => boolean }
```

- `name` — tool/action name string; `rawArgs` — the model-provided arguments,
  validated/normalized inside the runner (never trusted raw).
- `signal` — per-turn `AbortController.signal`; long-running work (fetches,
  camera waits, radio selection) must observe it.
- `isCurrent` — staleness probe. The runner re-checks
  `typeof runOptions.isCurrent !== 'function' || runOptions.isCurrent()`
  **after every await** and before applying any result to the scene. A stale
  turn returns `{ ok:false, error:'... superseded by a newer voice turn' }`
  instead of mutating shared state.

## The five gates (port all of them)

1. **Dedupe consecutive identical calls.** The same tool call can arrive twice
   (in GEV: once via `response.function_call_arguments.done` and once via
   `response.output_item.done`). Dedupe on call/item identity (call id), never
   on argument equality alone — but also drop a consecutive identical
   (name+args) call within the same turn so a stuttering model doesn't run the
   same camera move twice.
2. **A newer camera move supersedes the in-flight one.** Explicit navigation
   interrupts any active camera motion/tracking (`interruptCameraMotion`), and
   an in-flight `fly_to` whose turn is no longer current resolves
   `{ ok:false, superseded:true }` rather than yanking the camera late.
3. **EVERY tool call must be answered — or the model deadlocks.** Even calls
   that are skipped as superseded/duplicated are answered with an explicit
   result payload (GEV sends a `function_call_output` with
   `{ ok:false, superseded:true }`). Leaving one unanswered strands the model
   waiting forever. In the Claude SSE loop this means every `tool_use` block
   gets a `tool_result` — client-dispatched UI tools are answered server-side
   with `{ ok:true, note:'dispatched to map' }`.
4. **Per-turn AbortController.** Each user turn creates one
   `AbortController`; its signal is threaded into every action the turn spawns
   (the set is tracked, GEV: `activeToolAbortControllers`). A new user turn (or
   session teardown) aborts the previous turn's controllers before running.
5. **Staleness check before applying results.** After any async boundary,
   re-check `isCurrent()` (and `signal.aborted`) BEFORE touching the viewer,
   layers, panels, or announcing success. Results computed for a superseded
   turn are discarded with an honest `superseded` result, not applied.

## Result shape

Every action resolves (never throws to the caller) with a JSON-serializable
object: `{ ok: boolean, ...state }` on success — echoing the RESULTING state,
not the request — or `{ ok:false, error: '<plain sentence>' }` on failure.
