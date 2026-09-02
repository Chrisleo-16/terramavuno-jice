/**
 * Delivery types — getting the subsidised input to the farm instead of the
 * farmer to the depot.
 *
 * A delivery is downstream of a decision and never feeds back into one:
 * requesting delivery cannot make anyone eligible. What it inherits from the
 * engine is the honesty contract — in particular, a location we INFERRED (a
 * ward centroid) is never presented as a location the farmer PINNED.
 */

/**
 * How we came to believe where the farm is. This is the `derivation` axis of
 * the evidence model, applied to a coordinate.
 *
 * - `pin`    — the farmer dropped a pin on the map. Trust it.
 * - `gps`    — device geolocation. Trust it, subject to `accuracyMetres`.
 * - `ward_centroid` — NOBODY told us where the farm is; this is the middle of
 *   the ward. It must be labelled as approximate everywhere it is shown, and a
 *   driver must never be sent to it as though it were an address.
 */
export type LocationSource = 'pin' | 'gps' | 'ward_centroid';

export interface PinnedLocation {
  lat: number;
  lon: number;
  source: LocationSource;
  /** Reported accuracy for `gps`; null when unknown or not applicable. */
  accuracyMetres: number | null;
  /** Farmer's own words: "past the church, blue gate". Optional, never parsed. */
  landmark: string | null;
}

/**
 * Delivery lifecycle.
 *
 * `requested` is the farmer asking; `confirmed` is the depot accepting. The
 * two are deliberately distinct — an unconfirmed request must never be
 * described to a farmer as a booked delivery.
 */
export type DeliveryStatus =
  | 'requested'
  | 'confirmed'
  | 'dispatched'
  | 'in_transit'
  | 'delivered'
  | 'failed'
  | 'cancelled';

/** One movement in the delivery's history. Append-only: the audit trail. */
export interface DeliveryEvent {
  status: DeliveryStatus;
  at: string;
  /** Free-text reason, required for `failed` so a farmer is never left guessing. */
  note: string | null;
}

export interface Delivery {
  id: string;
  /**
   * Short code a farmer can read out on a phone call or type into USSD.
   * Built from a voice-safe alphabet — see `TRACKING_ALPHABET`.
   */
  trackingCode: string;
  /** Opaque farmer token. Never a name or a phone number. */
  farmerToken: string;
  wardCode: string | null;
  wardName: string | null;
  /** Depot the goods leave from. */
  depotId: string;
  depotName: string;
  /** Where the goods are going. */
  destination: PinnedLocation;
  bags: number;
  status: DeliveryStatus;
  /** Append-only history, oldest first. */
  history: DeliveryEvent[];
  /** Scheduled window start, ISO 8601, or null while unscheduled. */
  scheduledFor: string | null;
  createdAt: string;
  updatedAt: string;
  /** Provenance sentence, written by the API. */
  citation: string;
}
