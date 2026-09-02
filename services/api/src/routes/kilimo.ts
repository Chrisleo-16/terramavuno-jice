/**
 * kilimo.ts — REST mirrors of the five data tools.
 *
 * Two consumers:
 *  1. the ElevenLabs voice client, whose client tools fetch these endpoints
 *     (so voice and chat share ONE executor and cannot diverge);
 *  2. humans debugging the demo (curl / Invoke-RestMethod).
 *
 * Every response carries `dataMode` so a caller can badge live-vs-bundled.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  executeDataTool,
  listFarmers,
  type ToolResult,
} from '../tools/executor.js';

const wardQuery = z.object({ ward: z.string().trim().min(1).optional() });
const tokenParam = z.object({ token: z.string().trim().min(1) });
const evaluateBody = z.object({ token: z.string().trim().min(1) });

/** Map an executor result onto an HTTP response with a sensible status code. */
function send(res: Response, result: ToolResult): void {
  if (result.ok) {
    res.json({ ok: true, dataMode: result.dataMode, ...(result.data as object) });
    return;
  }
  const status = result.code === 'not_found' ? 404 : result.code === 'invalid_args' ? 400 : 500;
  res.status(status).json(result);
}

export const kilimoRouter: Router = Router();

/** GET /api/programme — the published programme rules + declared sources. */
kilimoRouter.get('/programme', async (_req: Request, res: Response) => {
  send(res, await executeDataTool('get_programme', {}));
});

/** GET /api/prices?ward=Ng'araria — gazetted price schedule. */
kilimoRouter.get('/prices', async (req: Request, res: Response) => {
  const parsed = wardQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, code: 'invalid_args', error: 'Invalid ward.', details: parsed.error.issues });
    return;
  }
  send(res, await executeDataTool('get_price_schedule', parsed.data));
});

/** GET /api/depots?ward=Ng'araria — depots, nearest-first when a ward is given. */
kilimoRouter.get('/depots', async (req: Request, res: Response) => {
  const parsed = wardQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, code: 'invalid_args', error: 'Invalid ward.', details: parsed.error.issues });
    return;
  }
  send(res, await executeDataTool('get_depots', parsed.data));
});

/** GET /api/farmers — every synthetic demo token. */
kilimoRouter.get('/farmers', async (_req: Request, res: Response) => {
  send(res, await listFarmers());
});

/** GET /api/farmers/:token — one synthetic token's recorded attributes. */
kilimoRouter.get('/farmers/:token', async (req: Request, res: Response) => {
  const parsed = tokenParam.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ ok: false, code: 'invalid_args', error: 'Invalid token.', details: parsed.error.issues });
    return;
  }
  send(res, await executeDataTool('get_farmer', parsed.data));
});

/** POST /api/evaluate { token } — the deterministic Decision. */
kilimoRouter.post('/evaluate', async (req: Request, res: Response) => {
  const parsed = evaluateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      code: 'invalid_args',
      error: 'Invalid evaluate request: expected { "token": "K-001" }.',
      details: parsed.error.issues,
    });
    return;
  }
  send(res, await executeDataTool('evaluate_farmer', parsed.data));
});
