import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const source=resolve(root,'references/kenya-locations/data/counties.json');
const counties=JSON.parse(readFileSync(source,'utf8'));
const esc=v=>String(v).replaceAll("'","''");
const rows=counties.map(c=>`('county','${esc(c.name)}','${String(c.code).padStart(3,'0')}','${esc(c.name.toLowerCase().replaceAll(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''))}','kenya-locations:${String(c.code).padStart(3,'0')}')`).join(',\n');
const sql=`-- Generated from references/kenya-locations/data/counties.json (MIT, David Amunga)\ninsert into public.administrative_areas(level,name,code,slug,source_id) values\n${rows}\non conflict(level,slug) do update set code=excluded.code, source_id=excluded.source_id;\n\ninsert into public.data_sources(id,name,publisher,url,license,classification,attribution,terms_checked_at) values\n('00000000-0000-0000-0000-000000000001','TerraMavuno demo benchmark','TerraMavuno','https://github.com/Chrisleo-16/claude-nairobi-impact-jice','Project documentation only','simulated','Synthetic values for interface demonstration; not official evidence.',now()),\n('00000000-0000-0000-0000-000000000002','Kenya Locations','David Amunga','https://github.com/davidamunga/kenya-locations','MIT','research','County names and codes from Kenya Locations; Copyright (c) 2025 David Amunga.',now())\non conflict(id) do nothing;\n\ninsert into public.interventions(slug,name,category,description) values\n('irrigation','Small-scale drip irrigation','water','Efficient small-scale irrigation package'),\n('protected-agriculture','Protected agriculture / greenhouses','production','Protected growing structures and setup'),\n('water-harvesting','Rainwater harvesting and storage','water','Household or community-scale capture and storage'),\n('climate-smart-crops','Climate-smart crop switching','agronomy','Seed, training and transition support'),\n('extension-support','Extension and advisory support','services','Field and digital farmer advisory'),\n('blended','Blended resilience portfolio','portfolio','Combined water, crop and extension package')\non conflict(slug) do update set name=excluded.name;\n`;
mkdirSync(resolve(root,'data'),{recursive:true});
writeFileSync(resolve(root,'data/kenya-counties.json'),JSON.stringify(counties,null,2)+'\n');
writeFileSync(resolve(root,'supabase/seed.sql'),sql);
console.log(`Generated ${counties.length} county rows and seed SQL.`);

