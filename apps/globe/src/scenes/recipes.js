/**
 * Scene recipes for Nielekeze by TerraMavuno.
 *
 * Replaces the God's Eye View recipes (Global Flights Radar, Orbital Watch,
 * Thermal Threat Board, City Overload, Omniscience Pullback), every one of
 * which drove layers this fork deleted (flights / satellites / earthquakes /
 * traffic). Each recipe is deterministic, so repeated runs produce the same
 * footage — that is what makes them safe to rehearse a demo against.
 *
 * `cameraPath[].alt` is an ABSOLUTE camera height in metres (not a range);
 * `duration` is the flight time to that shot and `hold` the dwell after it.
 *
 * LAYER IDs — the `layers` map is keyed by the layer id used at registration
 * time (`window.__KILIMO__.registerLayer({ id, ... })`, see src/main.js). The
 * Kenya layer modules in `src/data/kilimo/` register under the SAME ids the
 * `set_layer_visibility` tool schema enumerates, so there is one id space for
 * scenes, the panel and the agent:
 *
 *   wards | programme | prices | depots | farmers
 *
 * (`kilimo-wards`-style aliases still resolve through `layerRegistry`, but the
 * data manager only knows the canonical ids above, so recipes must use them.)
 *
 * An id that is not registered is silently skipped by
 * DataLayerManager.setEnabled, so these recipes stay playable while the layer
 * modules are still being authored — but a renamed layer stops appearing in
 * scenes, so keep the ids above in sync with the modules.
 *
 * Coordinates come from `src/data/local_data/kenya/centroids.json` (calculated
 * ward centroids) and `depots.muranga.json`, so the camera lands where the
 * polygons and the eligibility engine say a place is.
 */

/**
 * Ward centroids (calculated, from `src/data/local_data/kenya/centroids.json`)
 * duplicated here as PLAIN NUMBERS on purpose: recipes must stay a static,
 * dependency-free data module — the scene director imports it during boot, so
 * a fetch or a layer import here would put network/geometry work on the
 * critical path.
 */
export const KANDARA_WARD_SHOTS = Object.freeze({
  "Ng'araria": { lat: -0.93588, lon: 37.02661 },
  Muruka: { lat: -0.92609, lon: 37.05547 },
  'Kagundu-ini': { lat: -0.90542, lon: 37.0706 },
  Gaichanjiru: { lat: -0.87136, lon: 37.04936 },
  Ithiru: { lat: -0.88043, lon: 36.98795 },
  Ruchu: { lat: -0.83148, lon: 36.92132 },
});

/**
 * Build the cinematic Kenya descent for ONE ward: an establishing orbit over
 * Kenya, a descent onto Murang'a, a frame of the whole Kandara constituency,
 * then a push-in on the chosen ward.
 *
 * Every shot is a plain camera keyframe, so playback runs through the ordinary
 * SceneDirector path and stays INTERRUPTIBLE: Escape aborts the run, and any
 * camera command (a `fly_to_location` tool call, `layer.focus(...)`, or the
 * user grabbing the globe) supersedes the flight through
 * `interruptCameraMotion` / the director's camera-ownership claim. Nothing
 * here re-asserts the camera after an interruption, so the scene never fights
 * the user.
 *
 * @param {string} [wardName="Ng'araria"] Ward to push in on. An unknown name
 *   falls back to the Kandara centroid rather than inventing a location.
 * @returns {object} A SCENE_RECIPES-shaped recipe.
 */
export function buildKenyaDescentRecipe(wardName = "Ng'araria") {
  const ward = KANDARA_WARD_SHOTS[wardName] || { lat: -0.885, lon: 36.998 };
  const label = KANDARA_WARD_SHOTS[wardName] ? wardName : 'Kandara';
  return {
    id: `kenya-descent-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title: `Kenya Descent — establish, drop into Murang'a, push in on ${label}`,
    durationSec: 34,
    style: 'normal',
    ui: { hidePanels: false, hudMode: 'minimal', safeFrame: '16:9' },
    layers: {
      wards: true,
      programme: true,
      prices: false,
      depots: false,
      farmers: true,
    },
    post: { bloom: 46, sharpen: true, detectionMode: 'OFF' },
    cameraPath: [
      // 1. Establishing orbit: Kenya on the limb, equator crossing.
      { lat: 0.6, lon: 34.6, alt: 2600000, heading: 62, pitch: -58, roll: 0, duration: 6, hold: 1 },
      { lat: 0.4, lon: 39.4, alt: 2200000, heading: 300, pitch: -62, roll: 0, duration: 5, hold: 1 },
      // 2. Descent onto the central highlands, then Murang'a county.
      { lat: -0.4, lon: 37.3, alt: 420000, heading: 12, pitch: -58, roll: 0, duration: 5, hold: 1 },
      { lat: -0.80716, lon: 37.02909, alt: 74000, heading: 10, pitch: -52, roll: 0, duration: 4, hold: 1 },
      // 3. Frame the whole Kandara constituency — all six wards in shot.
      { lat: -0.885, lon: 36.998, alt: 26000, heading: 6, pitch: -55, roll: 0, duration: 4, hold: 1.5 },
      // 4. Push in on the ward the story is about.
      { lat: ward.lat, lon: ward.lon, alt: 6500, heading: 18, pitch: -38, roll: 0, duration: 4, hold: 2 },
    ],
  };
}

export const SCENE_RECIPES = [
  buildKenyaDescentRecipe("Ng'araria"),
  {
    id: 'kenya-arrival',
    title: "Kenya Arrival — orbit into Murang'a",
    durationSec: 28,
    style: 'normal',
    ui: { hidePanels: true, hudMode: 'minimal', safeFrame: '16:9' },
    layers: {
      'wards': true,
      'depots': false,
      'farmers': false,
    },
    post: {
      bloom: 48,
      sharpen: true,
      detectionMode: 'OFF',
    },
    cameraPath: [
      // Full-earth, Africa facing the camera.
      { lat: 2.0, lon: 22.0, alt: 15000000, heading: 0, pitch: -85, roll: 0, duration: 6, hold: 1 },
      // Kenya in frame, equator crossing.
      { lat: 0.5, lon: 37.9, alt: 2400000, heading: 8, pitch: -72, roll: 0, duration: 5, hold: 1 },
      // Central highlands: Mount Kenya to the north, Aberdares to the west.
      { lat: -0.60, lon: 37.10, alt: 320000, heading: 12, pitch: -60, roll: 0, duration: 5, hold: 1 },
      // Murang'a county.
      { lat: -0.80716, lon: 37.02909, alt: 62000, pitch: -52, heading: 10, roll: 0, duration: 4, hold: 1 },
      // Kandara constituency — where the demo happens.
      { lat: -0.85, lon: 36.95, alt: 18000, heading: 15, pitch: -42, roll: 0, duration: 4, hold: 0 },
    ],
  },
  {
    id: 'kandara-wards',
    title: 'Kandara Wards — the six participating wards',
    durationSec: 30,
    style: 'normal',
    ui: { hidePanels: false, hudMode: 'minimal', safeFrame: '16:9' },
    layers: {
      'wards': true,
      'farmers': true,
      'depots': false,
    },
    post: {
      bloom: 44,
      sharpen: true,
      detectionMode: 'OFF',
    },
    cameraPath: [
      // Whole constituency, then each ward centroid in register order.
      { lat: -0.885, lon: 36.998, alt: 24000, heading: 0, pitch: -55, roll: 0, duration: 4, hold: 1 },
      { lat: -0.93588, lon: 37.02661, alt: 7000, heading: 15, pitch: -38, roll: 0, duration: 4, hold: 1 }, // Ng'araria (K-001)
      { lat: -0.92609, lon: 37.05547, alt: 7000, heading: 340, pitch: -38, roll: 0, duration: 3, hold: 1 }, // Muruka (K-002)
      { lat: -0.90542, lon: 37.07060, alt: 7000, heading: 300, pitch: -38, roll: 0, duration: 3, hold: 1 }, // Kagundu-ini
      { lat: -0.87136, lon: 37.04936, alt: 7000, heading: 200, pitch: -38, roll: 0, duration: 3, hold: 1 }, // Gaichanjiru (K-003)
      { lat: -0.88043, lon: 36.98795, alt: 7000, heading: 90, pitch: -38, roll: 0, duration: 3, hold: 1 },  // Ithiru
      { lat: -0.83148, lon: 36.92132, alt: 7000, heading: 120, pitch: -38, roll: 0, duration: 3, hold: 0 }, // Ruchu
    ],
  },
  {
    id: 'depot-run',
    title: 'Depot Run — where do I actually go?',
    durationSec: 26,
    style: 'normal',
    ui: { hidePanels: false, hudMode: 'full', safeFrame: '16:9' },
    layers: {
      'wards': true,
      'depots': true,
      'farmers': true,
      'prices': true,
    },
    post: {
      bloom: 50,
      sharpen: true,
      detectionMode: 'OFF',
    },
    cameraPath: [
      // Start at the farmer's ward, then the two depots the demo contrasts:
      // NCPB Sagana (official, stock verified) and Kabati Agrovet (SIMULATED,
      // stock unknown — the "sijui" case).
      { lat: -0.93588, lon: 37.02661, alt: 6000, heading: 20, pitch: -40, roll: 0, duration: 4, hold: 1 },
      { lat: -0.80, lon: 37.10, alt: 42000, heading: 25, pitch: -50, roll: 0, duration: 4, hold: 1 },
      { lat: -0.66, lon: 37.20, alt: 4500, heading: 240, pitch: -35, roll: 0, duration: 4, hold: 2 }, // NCPB Sagana
      { lat: -0.83, lon: 37.08, alt: 38000, heading: 200, pitch: -50, roll: 0, duration: 3, hold: 1 },
      { lat: -0.90, lon: 36.98, alt: 4000, heading: 20, pitch: -34, roll: 0, duration: 4, hold: 2 }, // Kabati Agrovet
    ],
  },
];

/**
 * Look up a recipe by id.
 * @param {string} id Recipe id.
 * @returns {object|null} The recipe, or null when no recipe has that id.
 */
export function getSceneRecipeById(id) {
  return SCENE_RECIPES.find((recipe) => recipe.id === id) || null;
}
