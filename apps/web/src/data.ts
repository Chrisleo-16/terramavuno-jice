// Single source of truth lives in @terramavuno/shared so the console and the USSD/SMS channel
// quote identical figures. Re-exported here to keep the existing component imports stable.
export {demoSignals as counties} from '@terramavuno/shared';

export type LayerKey = 'rainfall'|'drought'|'vegetation'|'infrastructure';
export const layers: {key:LayerKey;label:string;color:string;source:string;freshness:string;confidence:string}[] = [
  {key:'rainfall',label:'Rainfall anomaly',color:'#45a6ff',source:'CHIRPS-compatible demo benchmark',freshness:'Demo snapshot • 2024',confidence:'Moderate'},
  {key:'drought',label:'Drought stress',color:'#ff9e47',source:'NDMA-style demo composite',freshness:'Demo snapshot • 2024',confidence:'Limited'},
  {key:'vegetation',label:'Vegetation / NDVI',color:'#6ee7a8',source:'Sentinel-compatible demo benchmark',freshness:'Demo snapshot • 2024',confidence:'Moderate'},
  {key:'infrastructure',label:'Water infrastructure',color:'#cda7ff',source:'Synthetic demonstration inventory',freshness:'Demo snapshot • 2024',confidence:'Limited'}
];

export const timeline = Array.from({length:6},(_,i)=>{
  const year=2020+i;
  return {year,rain:Math.round(62 + Math.sin(i*1.3)*18),drought:Math.round(52 + Math.cos(i*1.1)*21),ndvi:Math.round(55 + Math.sin(i*.8)*14),temperature:Number((24.1+i*.34).toFixed(1)),water:42+i*5,market:50+i*4,programme:35+i*8,budget:40+i*7};
});

