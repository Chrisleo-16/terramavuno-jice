import express from 'express'; import cors from 'cors'; import {createHash} from 'node:crypto'; import {z} from 'zod'; import {simulateClimateAction,claudeTools,farmerChannels} from '@terramavuno/shared';
export const app=express(); app.use(cors());app.use(express.json());
const input=z.object({county:z.string().min(1),budgetKes:z.number().positive(),objective:z.enum(['drought-resilience','food-security','farmer-income','water-security']),horizonYears:z.number().int().min(1).max(20)});

// Inbound farmer-channel return path. Raw MSISDNs must never reach the API or the database;
// an opaque provider session reference is salted and hashed here into the reporter_ref that
// conversations.channel_identity_hash expects.
const FIELD_REPORT_SOURCE_ID='00000000-0000-0000-0000-000000000003';
const msisdnLike=/^\+?\d[\d\s-]{6,}$/;
const hashIdentity=(ref:string)=>createHash('sha256').update(`${process.env.FIELD_REPORT_SALT??'terramavuno-dev-salt'}:${ref}`).digest('hex');
const fieldReport=z.object({channel:z.enum(farmerChannels),location:z.string().min(1),observation:z.string().min(1).max(2000),indicator:z.string().min(1).max(64).optional(),value:z.number().optional(),unit:z.string().max(32).optional(),observed_at:z.iso.datetime().optional(),reporter_ref:z.string().regex(/^[0-9a-f]{64}$/,'reporter_ref must be a 64-character sha256 hex digest').optional(),session_ref:z.string().min(1).max(128).optional(),confidence:z.enum(['high','moderate','limited','unknown']).default('unknown')})
  .refine(v=>!msisdnLike.test(v.session_ref??''),{path:['session_ref'],message:'session_ref looks like a phone number; hash channel identities in the adapter before they reach the API'});
app.get('/health',(_req,res)=>res.json({status:'ok',service:'terramavuno-api',dataMode:'simulated-benchmark'}));
app.get('/api/tools',(_req,res)=>res.json({tools:claudeTools,farmerChannels}));
app.post('/api/simulations',(req,res)=>{const parsed=input.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid simulation request',details:parsed.error.issues});return res.json({input:parsed.data,disclaimer:'SIMULATED BENCHMARK — validate costs with official county procurement and programme data before decisions.',options:simulateClimateAction(parsed.data)});});
app.post('/api/field-reports',(req,res)=>{
  const parsed=fieldReport.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:'Invalid field report',details:parsed.error.issues});
  const {session_ref,...report}=parsed.data;
  const now=new Date().toISOString();
  return res.status(202).json({
    record:{...report,source_id:FIELD_REPORT_SOURCE_ID,classification:'community',verification_status:'unverified',
      observed_at:report.observed_at??now,ingested_at:now,
      reporter_ref:report.reporter_ref??(session_ref?hashIdentity(session_ref):null)},
    disclaimer:'COMMUNITY REPORT — unverified, self-reported field observation. It is not official evidence and is not promoted to an observation without review.',
    persisted:false,
    note:'P0 exercises the channel contract only. No provider webhook or Supabase client is connected, so nothing is written to conversations or evidence_records yet.'
  });
});

