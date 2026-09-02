/**
 * Delivery persistence.
 *
 * In-memory by design for the demo: a delivery is operational state with a
 * short life, and the honest signal is `dataMode: 'bundled'` on every
 * response rather than a half-wired table that pretends otherwise. The
 * interface is the seam — a Supabase implementation drops in behind it without
 * touching the routes.
 *
 * Privacy: nothing here holds a phone number. Deliveries are keyed by opaque
 * farmer token and by tracking code.
 */
import type { Delivery } from '@terramavuno/shared';

export type DeliveryDataMode = 'supabase' | 'bundled';

export interface DeliveryPayload<T> {
  data: T;
  dataMode: DeliveryDataMode;
}

export interface DeliveryStore {
  list(): Promise<DeliveryPayload<Delivery[]>>;
  get(id: string): Promise<DeliveryPayload<Delivery | null>>;
  byTrackingCode(code: string): Promise<DeliveryPayload<Delivery | null>>;
  create(delivery: Delivery): Promise<DeliveryPayload<Delivery>>;
  /** Upsert by id. Used for status changes and pin corrections. */
  save(delivery: Delivery): Promise<DeliveryPayload<Delivery>>;
}

export class MemoryDeliveryStore implements DeliveryStore {
  private deliveries: Delivery[] = [];

  list(): Promise<DeliveryPayload<Delivery[]>> {
    return Promise.resolve({ data: [...this.deliveries], dataMode: 'bundled' });
  }

  get(id: string): Promise<DeliveryPayload<Delivery | null>> {
    return Promise.resolve({
      data: this.deliveries.find((d) => d.id === id) ?? null,
      dataMode: 'bundled',
    });
  }

  byTrackingCode(code: string): Promise<DeliveryPayload<Delivery | null>> {
    const wanted = code.trim().toUpperCase();
    return Promise.resolve({
      data: this.deliveries.find((d) => d.trackingCode === wanted) ?? null,
      dataMode: 'bundled',
    });
  }

  create(delivery: Delivery): Promise<DeliveryPayload<Delivery>> {
    this.deliveries.push(delivery);
    return Promise.resolve({ data: delivery, dataMode: 'bundled' });
  }

  save(delivery: Delivery): Promise<DeliveryPayload<Delivery>> {
    const index = this.deliveries.findIndex((d) => d.id === delivery.id);
    if (index === -1) this.deliveries.push(delivery);
    else this.deliveries[index] = delivery;
    return Promise.resolve({ data: delivery, dataMode: 'bundled' });
  }
}

let store: DeliveryStore | null = null;

export function getDeliveryStore(): DeliveryStore {
  store ??= new MemoryDeliveryStore();
  return store;
}

/** Test seam. */
export function setDeliveryStore(next: DeliveryStore | null): void {
  store = next;
}
