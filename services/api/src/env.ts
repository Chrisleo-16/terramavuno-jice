/**
 * Environment loading and integration flags.
 *
 * ALL secrets live in this service — none of these values is ever sent to the
 * browser. `/health` and the per-integration health routes report BOOLEANS
 * only (configured / not configured), never key values or lengths.
 *
 * The repo has a SINGLE root env file (apps/globe reads it via Vite's envDir;
 * we walk up to it from wherever the process was started). `.env.local` is
 * read before `.env` so the more specific file wins, and an already-set
 * process env ALWAYS wins over both, so injected production config is never
 * overridden by a stray local file.
 *
 * Deliberately dependency-free: this runs before anything else and should not
 * pull a package in just to split on "=".
 *
 * `server.ts` imports `loadEnv()` and calls it FIRST, ahead of app.js, which
 * reads configuration at import time.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function findUpwards(fileName: string, from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, fileName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function apply(path: string): void {
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    process.env[key] = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
}

/** Load root env files. Returns the paths actually read, for the boot log. */
export function loadEnv(from: string = process.cwd()): string[] {
  const loaded: string[] = [];
  // `.env.local` first: when both define a key, the more specific file wins.
  for (const name of ['.env.local', '.env']) {
    const path = findUpwards(name, from);
    if (path) {
      apply(path);
      loaded.push(path);
    }
  }
  return loaded;
}

// Load on import too, so a module that reads `env.*` without going through
// server.ts (tests, scripts) still sees the root file.
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

  /**
   * open-wa (@open-wa/wa-automate) running its EASY API server. Preferred over
   * the other two for farmer messaging: it drives an ordinary WhatsApp account,
   * so meeting notices can go to any number without the Cloud API's
   * template-approval process for business-initiated messages.
   */
  get openWaApiUrl(): string | undefined {
    return val('OPENWA_API_URL');
  },
  get openWaApiKey(): string | undefined {
    return val('OPENWA_API_KEY');
  },
  /** Optional: open-wa session name, only needed for multi-session hosts. */
  get openWaSession(): string | undefined {
    return val('OPENWA_SESSION');
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
      env.openWaApiUrl !== undefined ||
      (env.evolutionApiUrl !== undefined &&
        env.evolutionApiKey !== undefined &&
        env.evolutionInstanceName !== undefined) ||
      (env.whatsappCloudToken !== undefined && env.whatsappCloudPhoneNumberId !== undefined),
    googleMaps: env.googleMapsApiKey !== undefined,
    cesiumIon: env.cesiumIonToken !== undefined,
  };
}
