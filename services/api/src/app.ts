import express from 'express'; import cors from 'cors'; import {z} from 'zod'; import {simulateClimateAction,claudeTools} from '@terramavuno/shared';
export const app=express(); app.use(cors());app.use(express.json());
const input=z.object({county:z.string().min(1),budgetKes:z.number().positive(),objective:z.enum(['drought-resilience','food-security','farmer-income','water-security']),horizonYears:z.number().int().min(1).max(20)});
app.get('/health',(_req,res)=>res.json({status:'ok',service:'terramavuno-api',dataMode:'simulated-benchmark'}));
app.get('/api/tools',(_req,res)=>res.json({tools:claudeTools}));
app.post('/api/simulations',(req,res)=>{const parsed=input.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid simulation request',details:parsed.error.issues});return res.json({input:parsed.data,disclaimer:'SIMULATED BENCHMARK — validate costs with official county procurement and programme data before decisions.',options:simulateClimateAction(parsed.data)});});

