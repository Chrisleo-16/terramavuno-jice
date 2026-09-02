/**
 * Environment loading and integration flags.
 *
 * ALL secrets live in this service — none of these values is ever sent to the
 * browser. `/health` and the per-integration health routes report BOOLEANS
 * only (configured / not configured), never key values or lengths.
 *
 * The repo has a SINGLE root .env (apps/globe reads it via Vite's envDir; we
 * read it via dotenv). The path is resolved from import.meta.url so it works
 * from src/ under tsx AND from dist/ under node.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** Directory of this module (ESM-safe; __dirname does not exist here). */
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from this file looking for the repo-root .env. Depth 4 covers both
 * services/api/src/env.ts and services/api/dist/env.js layouts, plus a little
 * slack for future nesting.
 */
export function findRootEnvFile(startDir: string = here): string | null {
  let dir = startDir;
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let loaded = false;

/** Load the root .env exactly once. Existing process env always wins. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = findRootEnvFile();
  if (file) dotenv.config({ path: file });
}

loadEnv();

const val = (name: string): string | undefined => {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Secret-free view of what is configured. Safe to serialise to any client. */
export interface IntegrationFlags {
  anthropic: boolean;
  supabase: boolean;
  elevenlabs: boolean;
  whatsapp: boolean;
  googleMaps: boolean;
  cesiumIon: boolean;
}

export const env = {
  /** Anthropic (Claude chat). */
  get anthropicApiKey(): string | undefined {
    return val('ANTHROPIC_API_KEY');
  },
  /** Model id for the chat loop; overridable without a code change. */
  get anthropicModel(): string {
    return val('ANTHROPIC_MODEL') ?? 'claude-sonnet-5';
  },

  /** Supabase — server-side reads use the SECRET (service-role) key only. */
  get supabaseUrl(): string | undefined {
    return val('SUPABASE_URL') ?? val('VITE_SUPABASE_URL');
  },
  get supabaseSecretKey(): string | undefined {
    return val('SUPABASE_SECRET_KEY');
  },

  /** ElevenLabs voice — the browser only ever receives a signed URL. */
  get elevenLabsApiKey(): string | undefined {
    return val('ELEVENLABS_API_KEY');
  },
  get elevenLabsAgentId(): string | undefined {
    return val('ELEVENLABS_AGENT_ID');
  },

  /** WhatsApp share (Evolution API preferred, Cloud API fallback). */
  get evolutionApiUrl(): string | undefined {
    return val('EVOLUTION_API_URL');
  },
  get evolutionApiKey(): string | undefined {
    return val('EVOLUTION_API_KEY');
  },
  get evolutionInstanceName(): string | undefined {
    return val('EVOLUTION_INSTANCE_NAME');
  },
  get whatsappCloudToken(): string | undefined {
    return val('WHATSAPP_CLOUD_ACCESS_TOKEN');
  },
  get whatsappCloudPhoneNumberId(): string | undefined {
    return val('WHATSAPP_CLOUD_PHONE_NUMBER_ID');
  },

  /** Client-exposed keys — listed only so /health can report coverage. */
  get googleMapsApiKey(): string | undefined {
    return val('GOOGLE_MAPS_API_KEY');
  },
  get cesiumIonToken(): string | undefined {
    return val('VITE_CESIUM_ION_TOKEN') ?? val('CESIUM_ION_TOKEN');
  },
} as const;

/** Booleans only — never emit the values themselves. */
export function integrationFlags(): IntegrationFlags {
  return {
    anthropic: env.anthropicApiKey !== undefined,
    supabase: env.supabaseUrl !== undefined && env.supabaseSecretKey !== undefined,
    elevenlabs: env.elevenLabsApiKey !== undefined && env.elevenLabsAgentId !== undefined,
    whatsapp:
      (env.evolutionApiUrl !== undefined &&
        env.evolutionApiKey !== undefined &&
        env.evolutionInstanceName !== undefined) ||
      (env.whatsappCloudToken !== undefined && env.whatsappCloudPhoneNumberId !== undefined),
    googleMaps: env.googleMapsApiKey !== undefined,
    cesiumIon: env.cesiumIonToken !== undefined,
  };
}
