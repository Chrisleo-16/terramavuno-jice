import {describe,it,expect} from 'vitest';import request from 'supertest';import {app} from './app.js';
describe('api',()=>{it('is healthy',async()=>expect((await request(app).get('/health')).status).toBe(200));it('simulates six options',async()=>{const r=await request(app).post('/api/simulations').send({county:'Makueni',budgetKes:10000000,objective:'drought-resilience',horizonYears:3});expect(r.status).toBe(200);expect(r.body.options).toHaveLength(6);});});

