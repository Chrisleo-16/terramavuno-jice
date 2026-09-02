import {describe,it,expect} from 'vitest';import request from 'supertest';import {app} from './app.js';
describe('api',()=>{it('is healthy',async()=>expect((await request(app).get('/health')).status).toBe(200));it('simulates six options',async()=>{const r=await request(app).post('/api/simulations').send({county:'Makueni',budgetKes:10000000,objective:'drought-resilience',horizonYears:3});expect(r.status).toBe(200);expect(r.body.options).toHaveLength(6);});});
describe('farmer channel',()=>{
  it('accepts a ussd field report as unverified community evidence',async()=>{
    const r=await request(app).post('/api/field-reports').send({channel:'ussd',location:'Makueni',observation:'Short rains failed, replanted twice',indicator:'rainfall_onset',confidence:'limited',session_ref:'ussd-session-7781'});
    expect(r.status).toBe(202);
    expect(r.body.record.classification).toBe('community');
    expect(r.body.record.verification_status).toBe('unverified');
    expect(r.body.record.reporter_ref).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.persisted).toBe(false);
  });
  it('hashes the session reference deterministically and does not echo it',async()=>{
    const body={channel:'sms',location:'Turkana',observation:'Borehole not working',session_ref:'sms-thread-42'};
    const [a,b]=await Promise.all([request(app).post('/api/field-reports').send(body),request(app).post('/api/field-reports').send(body)]);
    expect(a.body.record.reporter_ref).toBe(b.body.record.reporter_ref);
    expect(JSON.stringify(a.body)).not.toContain('sms-thread-42');
  });
  it('rejects a raw phone number instead of hashing it',async()=>{
    const r=await request(app).post('/api/field-reports').send({channel:'ussd',location:'Makueni',observation:'Seed arrived',session_ref:'+254712345678'});
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('hash channel identities');
  });
  it('rejects an unknown channel and a non-hashed reporter_ref',async()=>{
    expect((await request(app).post('/api/field-reports').send({channel:'telegram',location:'Kitui',observation:'x'})).status).toBe(400);
    expect((await request(app).post('/api/field-reports').send({channel:'sms',location:'Kitui',observation:'x',reporter_ref:'0712345678'})).status).toBe(400);
  });
  it('exposes the inbound tool and ussd delivery in the Claude tool list',async()=>{
    const r=await request(app).get('/api/tools');
    const names=r.body.tools.map((t:{name:string})=>t.name);
    expect(names).toContain('record_field_report');
    expect(r.body.farmerChannels).toContain('ussd');
    expect(r.body.tools.find((t:{name:string})=>t.name==='send_report').input_schema.properties.channel.enum).toContain('ussd');
  });
});

