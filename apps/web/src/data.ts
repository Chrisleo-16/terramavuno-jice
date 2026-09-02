export const counties = [
  {name:'Makueni',lat:-2.2559,lng:37.8937,rain:412,ndvi:.31,drought:78,temp:28.7,water:46,trend:'high stress'},
  {name:'Kitui',lat:-1.3667,lng:38.0167,rain:438,ndvi:.34,drought:72,temp:28.1,water:51,trend:'high stress'},
  {name:'Nakuru',lat:-0.3031,lng:36.0800,rain:782,ndvi:.58,drought:38,temp:20.4,water:69,trend:'watch'},
  {name:'Murang’a',lat:-0.7839,lng:37.0400,rain:1140,ndvi:.71,drought:22,temp:19.8,water:74,trend:'stable'},
  {name:'Turkana',lat:3.1167,lng:35.6000,rain:238,ndvi:.18,drought:91,temp:31.2,water:29,trend:'critical'},
  {name:'Kisumu',lat:-0.1022,lng:34.7617,rain:1260,ndvi:.67,drought:18,temp:25.9,water:80,trend:'stable'},
  {name:'Uasin Gishu',lat:.5143,lng:35.2698,rain:1085,ndvi:.74,drought:25,temp:19.3,water:66,trend:'stable'},
  {name:'Garissa',lat:-0.4536,lng:39.6461,rain:301,ndvi:.23,drought:87,temp:30.6,water:34,trend:'critical'}
] as const;

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

