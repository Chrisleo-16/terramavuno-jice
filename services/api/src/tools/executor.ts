/**
 * executor.ts — server-side execution of the 5 DATA tools.
 *
 * This module is the SINGLE implementation shared by:
 *   - the Claude chat agentic loop (src/claude/route.ts), and
 *   - the REST endpoints the voice client calls (src/routes/kilimo.ts).
 * Chat and voice therefore cannot diverge: same provider, same engine, same
 * Decision object, same dataMode badge.
 *
 * Invariants:
 *  - evaluate_farmer NEVER re-implements eligibility. It loads farmer +
 *    programme + prices + depots via the provider and calls the shared,
 *    deterministic evaluateFarmer() with now = new Date().toISOString().
 *  - Arguments are Zod-validated; nothing throws. Failures come back as
 *    structured { ok: false, error, ... } results so they can be handed to
 *    the model as a tool_result instead of blowing up the SSE stream.
 */
import { z } from 'zod';
import { combineDataMode, provider, type DataMode, type DepotWithDistance } from '../data/provider.js';
import {
  KILIMO_SOURCES,
  evaluateFarmer,
  isDataTool,
  type Decision,
  type FarmerToken,
  type PriceRow,
  type ProgrammeRules,
} from '../shared.js';

/* ------------------------------------------------------------------ */
/* Result envelope                                                     */
/* ------------------------------------------------------------------ */

export interface ToolOk<T> {
  ok: true;
  dataMode: DataMode;
  data: T;
}

export interface ToolErr {
  ok: false;
  error: string;
  /** Machine-readable reason: 'unknown_tool' | 'invalid_args' | 'not_found' | 'internal'. */
  code: 'unknown_tool' | 'invalid_args' | 'not_found' | 'internal';
  details?: unknown;
}

export type ToolResult<T = unknown> = ToolOk<T> | ToolErr;

const err = (code: ToolErr['code'], error: string, details?: unknown): ToolErr =>
  details === undefined ? { ok: false, code, error } : { ok: false, code, error, details };

/* ------------------------------------------------------------------ */
/* Argument schemas — mirror packages/shared/src/tools/kilimo-tools.ts */
/* ------------------------------------------------------------------ */

const NoArgs = z.object({}).loose();
const WardArgs = z.object({ ward: z.string().trim().min(1).optional() }).loose();
const TokenArgs = z.object({ token: z.string().trim().min(1) }).loose();

/* ------------------------------------------------------------------ */
/* Payload shapes                                                      */
/* ------------------------------------------------------------------ */

export interface ProgrammePayload {
  programme: ProgrammeRules;
  /** Declared sources so the model can cite by id without a second call. */
  sources: typeof KILIMO_SOURCES;
}

export interface PricePayload {
  ward: string | null;
  prices: PriceRow[];
}

export interface DepotPayload {
  ward: string | null;
  depots: DepotWithDistance[];
}

export interface FarmerPayload {
  farmer: FarmerToken;
  /** Always true in this demo — every token is synthetic. */
  simulated: true;
}

export interface EvaluatePayload {
  decision: Decision;
}

/* ------------------------------------------------------------------ */
/* Individual tools                                                    */
/* ------------------------------------------------------------------ */

export async function getProgramme(): Promise<ToolResult<ProgrammePayload>> {
  const { data, dataMode } = await provider.getProgramme();
  return { ok: true, dataMode, data: { programme: data, sources: KILIMO_SOURCES } };
}

export async function getPriceSchedule(ward?: string): Promise<ToolResult<PricePayload>> {
  const { data, dataMode } = await provider.getPriceSchedule(ward);
  return { ok: true, dataMode, data: { ward: ward ?? null, prices: data } };
}

export async function getDepots(ward?: string): Promise<ToolResult<DepotPayload>> {
  const { data, dataMode } = await provider.getDepots(ward);
  return { ok: true, dataMode, data: { ward: ward ?? null, depots: data } };
}

export async function getFarmer(token: string): Promise<ToolResult<FarmerPayload>> {
  const { data, dataMode } = await provider.getFarmer(token);
  if (data === null) {
    return err(
      'not_found',
      `No farmer token "${token}" exists. Do not guess its attributes — ask the user to re-state the token (demo tokens look like K-001).`,
    );
  }
  return { ok: true, dataMode, data: { farmer: data, simulated: true } };
}

/**
 * The only path to an eligibility answer. Loads every input, then delegates to
 * the shared deterministic engine. `now` is read here (the engine stays pure).
 */
export async function evaluateFarmerTool(token: string): Promise<ToolResult<EvaluatePayload>> {
  const farmerPayload = await provider.getFarmer(token);
  const farmer = farmerPayload.data;
  if (farmer === null) {
    return err(
      'not_found',
      `No farmer token "${token}" exists, so eligibility cannot be evaluated. Do not guess — ask the user to re-state the token (demo tokens look like K-001).`,
    );
  }

  const [programmePayload, pricePayload, depotPayload] = await Promise.all([
    provider.getProgramme(),
    provider.getPriceSchedule(farmer.wardName),
    provider.getDepots(),
  ]);

  const dataMode = combineDataMode(
    farmerPayload.dataMode,
    programmePayload.dataMode,
    pricePayload.dataMode,
    depotPayload.dataMode,
  );

  const decision = evaluateFarmer({
    farmer,
    programme: programmePayload.data,
    prices: pricePayload.data,
    depots: depotPayload.data,
    now: new Date().toISOString(),
  });

  // The engine leaves dataMode unset by contract; the API layer stamps it.
  return { ok: true, dataMode, data: { decision: { ...decision, dataMode } } };
}

export async function listFarmers(): Promise<ToolResult<{ farmers: FarmerToken[] }>> {
  const { data, dataMode } = await provider.listFarmers();
  return { ok: true, dataMode, data: { farmers: data } };
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

/**
 * Execute one data tool by name. Never throws: every failure — unknown tool,
 * bad arguments, provider explosion — is returned as a structured ToolErr so
 * the agent loop can always answer the tool_use block.
 */
export async function executeDataTool(name: string, args: unknown): Promise<ToolResult> {
  try {
    if (!isDataTool(name)) {
      return err(
        'unknown_tool',
        `"${name}" is not a server-side data tool. Server-side tools are: get_programme, get_price_schedule, get_depots, get_farmer, evaluate_farmer.`,
      );
    }

    switch (name) {
      case 'get_programme': {
        const parsed = NoArgs.safeParse(args ?? {});
        if (!parsed.success) return err('invalid_args', 'get_programme takes no arguments.', parsed.error.issues);
        return await getProgramme();
      }
      case 'get_price_schedule': {
        const parsed = WardArgs.safeParse(args ?? {});
        if (!parsed.success) {
          return err('invalid_args', 'get_price_schedule accepts an optional ward name.', parsed.error.issues);
        }
        return await getPriceSchedule(parsed.data.ward);
      }
      case 'get_depots': {
        const parsed = WardArgs.safeParse(args ?? {});
        if (!parsed.success) {
          return err('invalid_args', 'get_depots accepts an optional ward name.', parsed.error.issues);
        }
        return await getDepots(parsed.data.ward);
      }
      case 'get_farmer': {
        const parsed = TokenArgs.safeParse(args ?? {});
        if (!parsed.success) {
          return err('invalid_args', 'get_farmer requires a token, e.g. { "token": "K-001" }.', parsed.error.issues);
        }
        return await getFarmer(parsed.data.token);
      }
      case 'evaluate_farmer': {
        const parsed = TokenArgs.safeParse(args ?? {});
        if (!parsed.success) {
          return err(
            'invalid_args',
            'evaluate_farmer requires a token, e.g. { "token": "K-001" }.',
            parsed.error.issues,
          );
        }
        return await evaluateFarmerTool(parsed.data.token);
      }
      default:
        // Dead code today: isDataTool() already accepted `name`, so reaching
        // here means a new data tool was added to the shared registry without
        // a branch above. Fail loudly-but-safely rather than silently.
        return err('unknown_tool', `Data tool "${String(name)}" has no server implementation yet.`);
    }
  } catch (error) {
    return err(
      'internal',
      error instanceof Error
        ? `Tool "${name}" failed: ${error.message}`
        : `Tool "${name}" failed for an unknown reason.`,
    );
  }
}
