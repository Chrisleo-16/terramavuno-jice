/**
 * Inbound farmer-channel return path, shared by the HTTP endpoint and the provider webhooks.
 *
 * Raw MSISDNs must never reach storage, logs or analytics. A provider session reference (or the
 * MSISDN itself, which only ever exists in memory for the length of one request) is salted and
 * hashed here into the `reporter_ref` that `conversations.channel_identity_hash` expects.
 */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {farmerChannels, matchCounty} from '@terramavuno/shared';

/** Seeded in supabase/seed.sql as the community-classified farmer-channel source. */
export const FIELD_REPORT_SOURCE_ID = '00000000-0000-0000-0000-000000000003';

const DEV_SALT = 'terramavuno-dev-salt';
export const usingDevSalt = () => !process.env.FIELD_REPORT_SALT?.trim();
export const hashIdentity = (ref: string) =>
  createHash('sha256').update(`${process.env.FIELD_REPORT_SALT?.trim() || DEV_SALT}:${ref}`).digest('hex');

const msisdnLike = /^\+?\d[\d\s-]{6,}$/;

export const fieldReportSchema = z.object({
  channel: z.enum(farmerChannels),
  location: z.string().min(1),
  observation: z.string().min(1).max(2000),
  indicator: z.string().min(1).max(64).optional(),
  value: z.number().optional(),
  unit: z.string().max(32).optional(),
  observed_at: z.iso.datetime().optional(),
  reporter_ref: z.string().regex(/^[0-9a-f]{64}$/, 'reporter_ref must be a 64-character sha256 hex digest').optional(),
  session_ref: z.string().min(1).max(128).optional(),
  /** Provider record id. Deduplicates retries — Africa's Talking re-posts inbound SMS on non-2xx. */
  source_record_id: z.string().min(1).max(200).optional(),
  confidence: z.enum(['high', 'moderate', 'limited', 'unknown']).default('unknown')
}).refine(v => !msisdnLike.test(v.session_ref ?? ''), {
  path: ['session_ref'],
  message: 'session_ref looks like a phone number; hash channel identities in the adapter before they reach the API'
});

export type FieldReportInput = z.infer<typeof fieldReportSchema>;

export interface FieldReportRecord {
  source_id: string;
  classification: 'community';
  verification_status: 'unverified';
  channel: FieldReportInput['channel'];
  location: string;
  /** Resolved county name when the free-text location matched one of the 47; null otherwise. */
  county: string | null;
  observation: string;
  indicator?: string;
  value?: number;
  unit?: string;
  confidence: FieldReportInput['confidence'];
  observed_at: string;
  ingested_at: string;
  reporter_ref: string | null;
  source_record_id?: string;
}

export function buildFieldReport(input: FieldReportInput, now = new Date()): FieldReportRecord {
  const {session_ref, reporter_ref, observed_at, location, ...rest} = input;
  const stamp = now.toISOString();
  return {
    ...rest,
    location,
    county: matchCounty(location)?.name ?? null,
    source_id: FIELD_REPORT_SOURCE_ID,
    classification: 'community',
    verification_status: 'unverified',
    observed_at: observed_at ?? stamp,
    ingested_at: stamp,
    reporter_ref: reporter_ref ?? (session_ref ? hashIdentity(session_ref) : null)
  };
}

export const FIELD_REPORT_DISCLAIMER =
  'COMMUNITY REPORT — unverified, self-reported field observation. It is not official evidence and is not promoted to an observation without review.';
