/**
 * Headless boot check for apps/globe.
 *
 * Loads the dev server, asserts the window.__KILIMO__ handle, the five Kenya
 * layers and the chat mount, then reports console/page errors.
 *
 * Usage:  npm run dev --workspace @terramavuno/globe   (in another terminal)
 *         node scripts/verify-globe-boot.mjs [out.png]
 *
 * Note: Cesium runs in requestRenderMode, so a screenshot taken without
 * forcing a render shows a blank globe even when tiles loaded fine.
 */
import puppeteer from 'puppeteer';
const errs=[], logs=[];
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader','--use-gl=angle','--enable-webgl','--ignore-gpu-blocklist','--disable-gpu-sandbox']});
const p=await b.newPage();
await p.setViewport({width:1600,height:900});
p.on('console',m=>{const t=m.type();const x=m.text();logs.push(`${t}: ${x}`);if(t==='error')errs.push(x);});
p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('requestfailed',r=>{const u=r.url();if(!/google|cesium\.com|ion\./.test(u))errs.push('REQFAIL: '+u+' '+(r.failure()?.errorText||''));});
await p.goto('http://localhost:4173/',{waitUntil:'networkidle2',timeout:90000});
await new Promise(r=>setTimeout(r,15000));
const state=await p.evaluate(()=>({
  handle: !!window.__KILIMO__,
  layers: window.__KILIMO__ ? [...window.__KILIMO__.layerRegistry.keys()] : [],
  chat: !!document.querySelector('#kilimo-chat-panel')?.children.length,
  mic: document.querySelector('#kilimo-mic')?.disabled,
  canvas: !!document.querySelector('canvas'),
  loader: document.querySelector('#loader-status')?.textContent||''
}));
await p.screenshot({path:process.argv[2]||'shot.png'});
console.log('STATE '+JSON.stringify(state,null,1));
console.log('ERRORS('+errs.length+'):'); errs.slice(0,15).forEach(e=>console.log('  - '+e.slice(0,200)));
await b.close();
