# GEV tool-schema array shape (reference)

Extracted from `references/gods-eye-view/vite.config.js` (the
`GEV_REALTIME_TOOLS` array, ~lines 5611–6233). Kept as the shape reference for
TerraMavuno's own tool schemas (`packages/shared/src/tools/kilimo-tools.ts`).
Source: God's Eye View (MIT), https://github.com/bilawalsidhu/gods-eye-view.

## Shape summary

`GEV_REALTIME_TOOLS` is a flat array of **28** OpenAI Realtime function tools.
Every entry follows the same conventions — worth copying:

- `type: 'function'`, snake_case `name`, an imperative `description` that also
  encodes usage POLICY (when to call it, what to say after, common aliases).
- `parameters` is standard JSON Schema: `type:'object'`,
  **`additionalProperties: false` on every object**, `enum` whenever the value
  space is closed, `minimum`/`maximum` on numbers, `maxLength` on free text,
  and a minimal `required` list (most args optional so the model can omit).
- Alias/disambiguation tables live inside property descriptions (e.g.
  "ships/vessels → ais-live-vessels"), not in separate docs — the model reads
  the schema.

Tool names (28): `fly_to_location`, `select_nearest_aircraft`,
`adjust_camera_zoom`, `zoom_to_globe`, `set_layer_visibility`,
`show_data_layers_menu`, `set_panel_open`, `set_context_mode`,
`control_cockpit`, `set_visual_style`, `get_entity_context`,
`get_current_view_state`, `set_hud`, `set_detection`, `set_map_stack`,
`set_post_processing`, `control_scene`, `control_cctv`, `control_radio`,
`track_entity`, `stop_tracking`, `frame_overhead`, `annotate_map`,
`clear_annotations`, `move_camera`, `fly_route`, `analyst_query`,
`next_iss_pass`.

## Full examples (verbatim)

### 1. `fly_to_location`

```js
{
  type: 'function',
  name: 'fly_to_location',
  description: "Fly the God's Eye View camera to a known city, geocoded country/region/city/landmark, or explicit WGS84 coordinate. Countries/cities frame the whole place; landmarks/buildings use close framing.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      locationId: {
        type: 'string',
        enum: ['austin', 'sf', 'nyc', 'tokyo', 'london', 'paris', 'dubai', 'dc'],
        description: 'Known city preset ID. Use when the requested place matches one of these cities.',
      },
      query: {
        type: 'string',
        description: 'Plain place search query, e.g. "London", "Eiffel Tower", or "Dubai Marina".',
      },
      latitude: { type: 'number', minimum: -90, maximum: 90 },
      longitude: { type: 'number', minimum: -180, maximum: 180 },
      viewMode: {
        type: 'string',
        enum: ['close', 'overview'],
        description: 'Optional framing intent. Usually omit this; GEV infers whole-place framing for countries/cities and close framing for landmarks.',
      },
      rangeM: {
        type: 'number',
        minimum: 100,
        maximum: 20000000,
        description: 'Optional camera range from the target in meters. Omit it for automatic whole-country/whole-city or close-landmark framing; provide it only when the user explicitly requests a numeric height or distance.',
      },
      waitForArrival: {
        type: 'boolean',
        description: 'Set true when a later tool depends on the destination viewport. The result then waits for the camera flight and returns arrived=true; cancellation returns ok=false.',
      },
    },
  },
}
```

### 2. `set_layer_visibility`

```js
{
  type: 'function',
  name: 'set_layer_visibility',
  description: "Enable or disable one registered God's Eye View data layer.",
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      layerId: {
        type: 'string',
        description:
          'Common-name mapping for the non-obvious ids: space mission(s) → rocket-launches; fires/wildfires/active fires → local-firms (NASA FIRMS); ships/vessels/boats → ais-live-vessels; undersea/submarine cables → telegeography-submarine-cables; datacenters → local-datacenters; dams → local-dams; bikes/bike share → bikeshare; street traffic/congestion → traffic; traffic cameras → cctv; internet radio/stations → radio.',
        enum: [
          'flights', 'military', 'earthquakes', 'satellites', 'rocket-launches',
          'traffic', 'cctv', 'radio', 'bikeshare', 'ais-live-vessels',
          'local-datacenters', 'local-dams', 'telegeography-submarine-cables',
          'local-firms',
        ],
      },
      enabled: { type: 'boolean' },
    },
    required: ['layerId', 'enabled'],
  },
}
```

### 3. `move_camera`

```js
{
  type: 'function',
  name: 'move_camera',
  description: 'Direct the camera like a drone operator: orbit the current view target, pan, tilt, or rotate — one bounded nudge (mode=once) or continuous motion until stopped (mode=continuous). Continuous motion also stops on any manual camera input or when a navigation tool runs. Say the RESULTING state when confirming ("Orbiting slowly").',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      motion: { type: 'string', enum: ['orbit', 'pan', 'tilt', 'rotate', 'stop'] },
      direction: { type: 'string', enum: ['left', 'right', 'up', 'down'], description: 'Required except for orbit (defaults right/clockwise) and stop.' },
      speed: { type: 'string', enum: ['slow', 'normal', 'fast'] },
      mode: { type: 'string', enum: ['once', 'continuous'], description: 'once = bounded eased nudge (default); continuous = until stop/manual input.' },
    },
    required: ['motion'],
  },
}
```
