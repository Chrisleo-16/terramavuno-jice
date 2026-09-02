/**
 * SIMULATED BENCHMARK county signals used by the web console and the farmer channel so both
 * surfaces quote the same numbers. These are illustrative demo values, not observations. Only a
 * subset of the 47 counties is covered on purpose: the channel must be able to say "no signal
 * yet" rather than invent one.
 */
export interface DemoCountySignal {
  name: string; lat: number; lng: number;
  rain: number; ndvi: number; drought: number; temp: number; water: number; trend: string;
}

export const demoSignals: readonly DemoCountySignal[] = [
  {name:'Makueni',lat:-2.2559,lng:37.8937,rain:412,ndvi:.31,drought:78,temp:28.7,water:46,trend:'high stress'},
  {name:'Kitui',lat:-1.3667,lng:38.0167,rain:438,ndvi:.34,drought:72,temp:28.1,water:51,trend:'high stress'},
  {name:'Nakuru',lat:-0.3031,lng:36.0800,rain:782,ndvi:.58,drought:38,temp:20.4,water:69,trend:'watch'},
  {name:'Murang’a',lat:-0.7839,lng:37.0400,rain:1140,ndvi:.71,drought:22,temp:19.8,water:74,trend:'stable'},
  {name:'Turkana',lat:3.1167,lng:35.6000,rain:238,ndvi:.18,drought:91,temp:31.2,water:29,trend:'critical'},
  {name:'Kisumu',lat:-0.1022,lng:34.7617,rain:1260,ndvi:.67,drought:18,temp:25.9,water:80,trend:'stable'},
  {name:'Uasin Gishu',lat:.5143,lng:35.2698,rain:1085,ndvi:.74,drought:25,temp:19.3,water:66,trend:'stable'},
  {name:'Garissa',lat:-0.4536,lng:39.6461,rain:301,ndvi:.23,drought:87,temp:30.6,water:34,trend:'critical'}
];

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export function findDemoSignal(county: string): DemoCountySignal | null {
  return demoSignals.find(s => key(s.name) === key(county)) ?? null;
}
