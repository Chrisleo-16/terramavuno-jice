/**
 * app.ts — the TerraMavuno API surface. ALL secrets live in this process;
 * the browser only ever receives data, SSE events and signed URLs.
 *
 * Routes
 *   GET  /health                  service + dataMode + integration booleans
 *   GET  /api/tools               tool schemas (legacy claudeTools + Kilimo)
 *   POST /api/simulations         legacy climate-action benchmark
 *   GET  /api/programme           programme rules + sources
 *   GET  /api/prices              gazetted price schedule
 *   GET  /api/depots              depots (nearest-first with ?ward=)
 *   GET  /api/farmers             all synthetic tokens
 *   GET  /api/farmers/:token      one synthetic token
 *   POST /api/evaluate            deterministic Decision
 *   POST /api/chat                Claude agentic loop (SSE)
 *   GET  /api/voice/signed-url    ElevenLabs signed URL broker
 *   GET  /api/voice/health        voice availability
 *   POST /api/share/whatsapp      send a Decision to WhatsApp
 *   GET  /api/share/health        share availability
 */
import cors from 'cors';
import express from 'express';
import { z } from 'zod';
import { claudeTools, simulateClimateAction } from '@terramavuno/shared';
import { integrationFlags } from './env.js';
import { chatHandler } from './claude/route.js';
import { provider } from './data/provider.js';
import { kilimoRouter } from './routes/kilimo.js';
import { shareRouter } from './routes/share.js';
import { voiceRouter } from './routes/voice.js';
import { KILIMO_TOOLS, toAnthropicTools, toElevenLabsClientTools } from './shared.js';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '512kb' }));

const input = z.object({
  county: z.string().min(1),
  budgetKes: z.number().positive(),
  objective: z.enum([
    'drought-resilience',
    'food-security',
    'farmer-income',
    'water-security',
  ]),
  horizonYears: z.number().int().min(1).max(20),
});

/**
 * Health probe. Reports which integrations are CONFIGURED as booleans only —
 * never a key, a prefix, or a length — plus the live dataMode, discovered by
 * asking the provider for the programme (which falls back in <=1.5 s).
 */
app.get('/health', async (_req, res) => {
  const { dataMode } = await provider.getProgramme();
  res.json({
    status: 'ok',
    service: 'terramavuno-api',
    dataMode,
    integrations: integrationFlags(),
  });
});

/** Tool schemas. The Kilimo registry is the single source of truth for both channels. */
app.get('/api/tools', (_req, res) =>
  res.json({
    tools: claudeTools,
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

// Kilimo data endpoints (voice client + debugging).
app.use('/api', kilimoRouter);

// Claude text chat: manual agentic tool-use loop, streamed as SSE.
app.post('/api/chat', chatHandler);

// ElevenLabs signed-URL broker and WhatsApp share.
app.use('/api/voice', voiceRouter);
app.use('/api/share', shareRouter);
