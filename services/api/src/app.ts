import express,{type Express} from 'express'; import cors from 'cors'; import {z} from 'zod'; import {simulateClimateAction,claudeTools,farmerChannels} from '@terramavuno/shared';
import {buildFieldReport,fieldReportSchema,usingDevSalt,FIELD_REPORT_DISCLAIMER} from './field-reports.js';
import {createChannelRouter,type ChannelDeps} from './channels.js';
import {loadAfricasTalkingConfig} from './africastalking.js';
import {InMemoryChannelStore} from './channel-store.js';
import {createSupabaseChannelStore,loadSupabaseConfig} from './supabase-channel-store.js';

const input=z.object({county:z.string().min(1),budgetKes:z.number().positive(),objective:z.enum(['drought-resilience','food-security','farmer-income','water-security']),horizonYears:z.number().int().min(1).max(20)});

/** `deps` lets tests inject a channel store and a fake SMS sender instead of a live provider. */
export function createApp(deps: ChannelDeps = {}): Express {
  const app=express(); app.use(cors()); app.use(express.json());
  // Africa's Talking posts webhooks as application/x-www-form-urlencoded.
  app.use(express.urlencoded({extended:false}));

  // Durable storage when Supabase is configured; in-memory otherwise, so the channel still runs.
  const store=deps.store ?? createSupabaseChannelStore() ?? new InMemoryChannelStore();

  app.get('/health',(_req,res)=>{const at=loadAfricasTalkingConfig();return res.json({status:'ok',service:'terramavuno-api',dataMode:'simulated-benchmark',
    channels:{provider:at?`africastalking:${at.environment}`:'not-configured',webhooksEnabled:Boolean(process.env.CHANNEL_WEBHOOK_TOKEN?.trim()),identitySalt:usingDevSalt()?'dev-default (set FIELD_REPORT_SALT)':'configured',
      store:deps.store?'injected':loadSupabaseConfig()?'supabase (service role)':'in-memory (reports lost on restart)'}});});
  app.get('/api/tools',(_req,res)=>res.json({tools:claudeTools,farmerChannels}));
  app.post('/api/simulations',(req,res)=>{const parsed=input.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid simulation request',details:parsed.error.issues});return res.json({input:parsed.data,disclaimer:'SIMULATED BENCHMARK — validate costs with official county procurement and programme data before decisions.',options:simulateClimateAction(parsed.data)});});
  app.post('/api/field-reports',async(req,res)=>{
    const parsed=fieldReportSchema.safeParse(req.body);
    if(!parsed.success)return res.status(400).json({error:'Invalid field report',details:parsed.error.issues});
    const record=buildFieldReport(parsed.data);
    // `conversations` requires an account or a hashed channel identity, so a report with neither
    // cannot be attached to one. Report that honestly instead of dropping it silently.
    if(!record.reporter_ref){
      return res.status(202).json({record,disclaimer:FIELD_REPORT_DISCLAIMER,persisted:false,
        note:'Not stored: no reporter_ref or session_ref supplied, so the report cannot be attached to a conversation.'});
    }
    try{
      const {id}=await store.openConversation(record.channel,record.reporter_ref);
      const result=await store.saveFieldReport(id,record);
      return res.status(202).json({record,disclaimer:FIELD_REPORT_DISCLAIMER,persisted:result.persisted,duplicate:result.duplicate??false,
        note:result.persisted?'Stored as unverified community evidence with a provenance event.':'Held in memory only: Supabase is not configured (SUPABASE_URL / SUPABASE_SECRET_KEY).'});
    }catch(err){
      console.error('[api] field report persistence failed:',err instanceof Error?err.message:err);
      return res.status(503).json({error:'Field report accepted but could not be stored',record,disclaimer:FIELD_REPORT_DISCLAIMER,persisted:false});
    }
  });
  app.use('/channels',createChannelRouter({...deps,store}));
  return app;
}

export const app=createApp();
