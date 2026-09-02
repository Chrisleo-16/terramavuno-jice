/**
 * app.ts — the TerraMavuno API surface. ALL secrets live in this process;
 * the browser only ever receives data, SSE events and signed URLs.
 *
 * Two product surfaces share this server:
 *   • Kilimo, Nitapata? — the subsidy navigator behind the Cesium globe.
 *   • Farmer channels   — the Africa's Talking USSD / SMS field channel.
 *
 * Routes
 *   GET  /health                  service + dataMode + integrations + channels
 *   GET  /api/tools               schemas (legacy claudeTools + Kilimo + channels)
 *   POST /api/simulations         legacy climate-action benchmark
 *   POST /api/field-reports       community field report -> conversation + provenance
 *   GET  /api/programme           programme rules + sources
 *   GET  /api/prices              gazetted price schedule
 *   GET  /api/depots              depots (nearest-first with ?ward=)
 *   GET  /api/farmers[/:token]    synthetic farmer tokens
 *   POST /api/evaluate            deterministic Decision
 *   POST /api/chat                Claude agentic loop (SSE)
 *   GET  /api/voice/signed-url    ElevenLabs signed URL broker
 *   GET  /api/voice/health        voice availability
 *   POST /api/share/whatsapp      send a Decision to WhatsApp
 *   GET  /api/share/health        share availability
 *   *    /channels/*              Africa's Talking USSD + SMS webhooks
 */
import cors from 'cors';
import express, { type Express } from 'express';
import { z } from 'zod';
import { claudeTools, farmerChannels, simulateClimateAction } from '@terramavuno/shared';
import { integrationFlags } from './env.js';
import { chatHandler } from './claude/route.js';
import { provider } from './data/provider.js';
import { kilimoRouter } from './routes/kilimo.js';
import { shareRouter } from './routes/share.js';
import { voiceRouter } from './routes/voice.js';
import { KILIMO_TOOLS, toAnthropicTools, toElevenLabsClientTools } from './shared.js';
import {
  buildFieldReport,
  fieldReportSchema,
  usingDevSalt,
  FIELD_REPORT_DISCLAIMER,
} from './field-reports.js';
import { createChannelRouter, type ChannelDeps } from './channels.js';
import { loadAfricasTalkingConfig } from './africastalking.js';
import { InMemoryChannelStore } from './channel-store.js';
import { createSupabaseChannelStore, loadSupabaseConfig } from './supabase-channel-store.js';

const input = z.object({
  county: z.string().min(1),
  budgetKes: z.number().positive(),
  objective: z.enum(['drought-resilience', 'food-security', 'farmer-income', 'water-security']),
  horizonYears: z.number().int().min(1).max(20),
});

/** `deps` lets tests inject a channel store and a fake SMS sender instead of a live provider. */
export function createApp(deps: ChannelDeps = {}): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '512kb' }));
  // Africa's Talking posts webhooks as application/x-www-form-urlencoded.
  app.use(express.urlencoded({ extended: false }));

  // Durable storage when Supabase is configured; in-memory otherwise, so the channel still runs.
  const store = deps.store ?? createSupabaseChannelStore() ?? new InMemoryChannelStore();

  /**
   * Health probe. Reports which integrations are CONFIGURED as booleans only —
   * never a key, a prefix, or a length — plus the live dataMode, discovered by
   * asking the provider for the programme (which falls back within its budget).
   */
  app.get('/health', async (_req, res) => {
    const { dataMode } = await provider.getProgramme();
    const at = loadAfricasTalkingConfig();
    res.json({
      status: 'ok',
      service: 'terramavuno-api',
      dataMode,
      integrations: integrationFlags(),
      channels: {
        provider: at ? `africastalking:${at.environment}` : 'not-configured',
        webhooksEnabled: Boolean(process.env.CHANNEL_WEBHOOK_TOKEN?.trim()),
        identitySalt: usingDevSalt() ? 'dev-default (set FIELD_REPORT_SALT)' : 'configured',
        store: deps.store
          ? 'injected'
          : loadSupabaseConfig()
            ? 'supabase (service role)'
            : 'in-memory (reports lost on restart)',
      },
    });
  });

  /** Tool schemas. The Kilimo registry is the single source of truth for both AI channels. */
  app.get('/api/tools', (_req, res) =>
    res.json({
      tools: claudeTools,
      farmerChannels,
      kilimo: {
        registry: KILIMO_TOOLS,
        anthropic: toAnthropicTools(),
        elevenlabs: toElevenLabsClientTools(),
      },
    }),
  );

  app.post('/api/simulations', (req, res) => {
    const parsed = input.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ error: 'Invalid simulation request', details: parsed.error.issues });
    }
    return res.json({
      input: parsed.data,
      disclaimer:
        'SIMULATED BENCHMARK — validate costs with official county procurement and programme data before decisions.',
      options: simulateClimateAction(parsed.data),
    });
  });

  app.post('/api/field-reports', async (req, res) => {
    const parsed = fieldReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid field report', details: parsed.error.issues });
    }
    const record = buildFieldReport(parsed.data);
    // `conversations` requires an account or a hashed channel identity, so a report with neither
    // cannot be attached to one. Report that honestly instead of dropping it silently.
    if (!record.reporter_ref) {
      return res.status(202).json({
        record,
        disclaimer: FIELD_REPORT_DISCLAIMER,
        persisted: false,
        note: 'Not stored: no reporter_ref or session_ref supplied, so the report cannot be attached to a conversation.',
      });
    }
    try {
      const { id } = await store.openConversation(record.channel, record.reporter_ref);
      const result = await store.saveFieldReport(id, record);
      return res.status(202).json({
        record,
        disclaimer: FIELD_REPORT_DISCLAIMER,
        persisted: result.persisted,
        duplicate: result.duplicate ?? false,
        note: result.persisted
          ? 'Stored as unverified community evidence with a provenance event.'
          : 'Held in memory only: Supabase is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY).',
      });
    } catch (err) {
      console.error(
        '[api] field report persistence failed:',
        err instanceof Error ? err.message : err,
      );
      return res.status(503).json({
        error: 'Field report accepted but could not be stored',
        record,
        disclaimer: FIELD_REPORT_DISCLAIMER,
        persisted: false,
      });
    }
  });

  // Kilimo data endpoints (voice client + debugging).
  app.use('/api', kilimoRouter);

  // Claude text chat: manual agentic tool-use loop, streamed as SSE.
  app.post('/api/chat', chatHandler);

  // ElevenLabs signed-URL broker and WhatsApp share.
  app.use('/api/voice', voiceRouter);
  app.use('/api/share', shareRouter);

  // Africa's Talking USSD + SMS webhooks.
  app.use('/channels', createChannelRouter({ ...deps, store }));

  return app;
}

export const app = createApp();
