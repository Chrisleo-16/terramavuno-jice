-- Generated from references/kenya-locations/data/counties.json (MIT, David Amunga)
insert into public.administrative_areas(level,name,code,slug,source_id) values
('county','Baringo','030','baringo','kenya-locations:030'),
('county','Bomet','036','bomet','kenya-locations:036'),
('county','Bungoma','039','bungoma','kenya-locations:039'),
('county','Busia','040','busia','kenya-locations:040'),
('county','Elgeyo-Marakwet','028','elgeyo-marakwet','kenya-locations:028'),
('county','Embu','014','embu','kenya-locations:014'),
('county','Garissa','007','garissa','kenya-locations:007'),
('county','Homa Bay','043','homa-bay','kenya-locations:043'),
('county','Isiolo','011','isiolo','kenya-locations:011'),
('county','Kajiado','034','kajiado','kenya-locations:034'),
('county','Kakamega','037','kakamega','kenya-locations:037'),
('county','Kericho','035','kericho','kenya-locations:035'),
('county','Kiambu','022','kiambu','kenya-locations:022'),
('county','Kilifi','003','kilifi','kenya-locations:003'),
('county','Kirinyaga','020','kirinyaga','kenya-locations:020'),
('county','Kisii','045','kisii','kenya-locations:045'),
('county','Kisumu','042','kisumu','kenya-locations:042'),
('county','Kitui','015','kitui','kenya-locations:015'),
('county','Kwale','002','kwale','kenya-locations:002'),
('county','Laikipia','031','laikipia','kenya-locations:031'),
('county','Lamu','005','lamu','kenya-locations:005'),
('county','Machakos','016','machakos','kenya-locations:016'),
('county','Makueni','017','makueni','kenya-locations:017'),
('county','Mandera','009','mandera','kenya-locations:009'),
('county','Marsabit','010','marsabit','kenya-locations:010'),
('county','Meru','012','meru','kenya-locations:012'),
('county','Migori','044','migori','kenya-locations:044'),
('county','Mombasa','001','mombasa','kenya-locations:001'),
('county','Murang''a','021','murang-a','kenya-locations:021'),
('county','Nairobi','047','nairobi','kenya-locations:047'),
('county','Nakuru','032','nakuru','kenya-locations:032'),
('county','Nandi','029','nandi','kenya-locations:029'),
('county','Narok','033','narok','kenya-locations:033'),
('county','Nyamira','046','nyamira','kenya-locations:046'),
('county','Nyandarua','018','nyandarua','kenya-locations:018'),
('county','Nyeri','019','nyeri','kenya-locations:019'),
('county','Samburu','025','samburu','kenya-locations:025'),
('county','Siaya','041','siaya','kenya-locations:041'),
('county','Taita-Taveta','006','taita-taveta','kenya-locations:006'),
('county','Tana River','004','tana-river','kenya-locations:004'),
('county','Tharaka-Nithi','013','tharaka-nithi','kenya-locations:013'),
('county','Trans Nzoia','026','trans-nzoia','kenya-locations:026'),
('county','Turkana','023','turkana','kenya-locations:023'),
('county','Uasin Gishu','027','uasin-gishu','kenya-locations:027'),
('county','Vihiga','038','vihiga','kenya-locations:038'),
('county','Wajir','008','wajir','kenya-locations:008'),
('county','West Pokot','024','west-pokot','kenya-locations:024')
on conflict(level,slug) do update set code=excluded.code, source_id=excluded.source_id;

insert into public.data_sources(id,name,publisher,url,license,classification,attribution,terms_checked_at) values
('00000000-0000-0000-0000-000000000001','TerraMavuno demo benchmark','TerraMavuno','https://github.com/Chrisleo-16/claude-nairobi-impact-jice','Project documentation only','simulated','Synthetic values for interface demonstration; not official evidence.',now()),
('00000000-0000-0000-0000-000000000002','Kenya Locations','David Amunga','https://github.com/davidamunga/kenya-locations','MIT','research','County names and codes from Kenya Locations; Copyright (c) 2025 David Amunga.',now()),
-- Inbound farmer-channel reports (USSD/SMS/IVR/WhatsApp). This is the only source of
-- community-classified observations in the model: the return path from the people a county
-- allocation is spent on. Records land unverified and must not be presented as official.
('00000000-0000-0000-0000-000000000003','Farmer channel field reports','TerraMavuno omnichannel',null,'Reporter-contributed; retained with consent','community','Self-reported field observations from farmers and field officers over USSD, SMS, IVR or WhatsApp. Unverified until reviewed; reporter identities are stored only as salted hashes.',now())
on conflict(id) do nothing;

insert into public.interventions(slug,name,category,description) values
('irrigation','Small-scale drip irrigation','water','Efficient small-scale irrigation package'),
('protected-agriculture','Protected agriculture / greenhouses','production','Protected growing structures and setup'),
('water-harvesting','Rainwater harvesting and storage','water','Household or community-scale capture and storage'),
('climate-smart-crops','Climate-smart crop switching','agronomy','Seed, training and transition support'),
('extension-support','Extension and advisory support','services','Field and digital farmer advisory'),
('blended','Blended resilience portfolio','portfolio','Combined water, crop and extension package')
on conflict(slug) do update set name=excluded.name;

-- === KILIMO, NITAPATA? seed ===
-- Fertilizer-subsidy navigator demo data. Idempotent: fixed UUIDs + on conflict
-- upserts + not-exists guards. Requires migration 20260903000000_kilimo_subsidy.sql
-- (farmer_tokens, subsidy_prices, programmes.slug).
-- NO PII: farmer rows are synthetic tokens (K-001…) with classification 'simulated'.

-- --- data sources -----------------------------------------------------------
insert into public.data_sources(id,name,publisher,url,license,classification,refresh_frequency,attribution,terms_checked_at) values
('00000000-0000-0000-0000-000000000101','MoALD subsidy circular','Ministry of Agriculture and Livestock Development (MoALD)','https://kilimo.go.ke','Government of Kenya public circular','official','per season','National Fertilizer Subsidy Programme circular, MoALD, 2026 Long Rains, effective 2026-08-14.','2026-09-02T00:00:00Z'),
('00000000-0000-0000-0000-000000000102','Kenya Gazette price notice','Government Printer, Republic of Kenya','https://gazettes.africa/gazettes/ke','Public gazette notice','official','per notice','Kenya Gazette price notice for subsidized fertilizer, 2026 Long Rains, effective 2026-08-14.','2026-09-02T00:00:00Z'),
('00000000-0000-0000-0000-000000000103','NCPB depot list','National Cereals and Produce Board','https://ncpb.co.ke','Public depot listing','official','daily stock reports','NCPB public depot list and stock reports.','2026-09-02T06:00:00Z'),
('00000000-0000-0000-0000-000000000104','geoBoundaries KEN','geoBoundaries.org (William & Mary geoLab)','https://www.geoboundaries.org','CC BY 4.0','research','per release','Administrative boundaries from geoBoundaries.org, CC BY 4.0.','2026-09-02T00:00:00Z'),
('00000000-0000-0000-0000-000000000105','TerraMavuno synthetic generator','TerraMavuno','https://github.com/Chrisleo-16/claude-nairobi-impact-jice','Project documentation only','simulated',null,'Synthetic demo entities (agro-dealer depots, farmer tokens) generated for interface demonstration; not official evidence.','2026-09-02T00:00:00Z')
on conflict(id) do update set name=excluded.name, publisher=excluded.publisher, classification=excluded.classification, attribution=excluded.attribution;

-- --- administrative areas: Murang'a > Kandara > 6 wards ---------------------
-- Murang'a county already exists from the 47-county block above; this upsert
-- only adds its centroid. Centroids are approximate (derivation: inferred).
insert into public.administrative_areas(level,name,code,slug,centroid,source_id) values
('county','Murang''a','021','murang-a', extensions.st_setsrid(extensions.st_makepoint(37.05,-0.75),4326)::extensions.geography, 'kenya-locations:021')
on conflict(level,slug) do update set code=excluded.code, centroid=excluded.centroid;

insert into public.administrative_areas(level,name,code,slug,parent_id,centroid,source_id)
select 'constituency','Kandara','109','kandara', c.id,
       extensions.st_setsrid(extensions.st_makepoint(36.95,-0.85),4326)::extensions.geography,
       'kenya-locations:constituency:109'
from public.administrative_areas c where c.level='county' and c.slug='murang-a'
on conflict(level,slug) do update set code=excluded.code, parent_id=excluded.parent_id, centroid=excluded.centroid;

insert into public.administrative_areas(level,name,code,slug,parent_id,centroid,source_id)
select 'ward', v.name, v.code, v.slug, k.id,
       extensions.st_setsrid(extensions.st_makepoint(v.lon,v.lat),4326)::extensions.geography,
       'kenya-locations:ward:'||v.code
from (values
  ('Ng''araria','0539','ng-araria',36.98,-0.79),
  ('Muruka','0540','muruka',36.92,-0.82),
  ('Kagundu-ini','0541','kagundu-ini',36.94,-0.91),
  ('Gaichanjiru','0542','gaichanjiru',36.99,-0.85),
  ('Ithiru','0543','ithiru',37.02,-0.82),
  ('Ruchu','0544','ruchu',36.90,-0.88)
) as v(name,code,slug,lon,lat)
cross join (select id from public.administrative_areas where level='constituency' and slug='kandara') k
on conflict(level,slug) do update set code=excluded.code, parent_id=excluded.parent_id, centroid=excluded.centroid;

-- --- programme: National Fertilizer Subsidy Programme, 2026 Long Rains ------
-- metadata is the engine's ProgrammeRules shape verbatim:
--   criteria[]: {id,label,test,param,evidence{authority,derivation,sourceId,citation,checkedAt}}
--   allocationFormula {bagsPerAcre,maxBags}, participatingWards[].
insert into public.programmes(id,slug,area_id,source_id,name,organization,status,start_date,end_date,currency,metadata) values
('00000000-0000-0000-0000-000000000201','ken-fert-subsidy-2026',null,'00000000-0000-0000-0000-000000000101',
 'National Fertilizer Subsidy Programme','Ministry of Agriculture and Livestock Development (MoALD)','active','2026-08-14','2026-12-31','KES',
$json$
{
  "slug": "ken-fert-subsidy-2026",
  "season": "2026 Long Rains",
  "scope": "national",
  "effective": "2026-08-14",
  "criteria": [
    {"id":"in_register","label":"Listed in the Kenya Farmer Register","test":"in_register","param":null,
     "evidence":{"authority":"official","derivation":"direct","sourceId":"moald-subsidy-circular","citation":"MoALD subsidy circular, 2026 Long Rains, effective 2026-08-14","checkedAt":"2026-08-14T00:00:00Z"}},
    {"id":"id_linked","label":"National ID linked to register entry","test":"id_linked","param":null,
     "evidence":{"authority":"official","derivation":"direct","sourceId":"moald-subsidy-circular","citation":"MoALD subsidy circular, 2026 Long Rains, effective 2026-08-14","checkedAt":"2026-08-14T00:00:00Z"}},
    {"id":"acreage_max","label":"Farm size at or under 5 acres","test":"acreage_max","param":5,
     "evidence":{"authority":"official","derivation":"direct","sourceId":"moald-subsidy-circular","citation":"MoALD subsidy circular, 2026 Long Rains, effective 2026-08-14","checkedAt":"2026-08-14T00:00:00Z"}},
    {"id":"ward_participating","label":"Ward is in the programme participating list","test":"ward_participating","param":null,
     "evidence":{"authority":"official","derivation":"direct","sourceId":"moald-subsidy-circular","citation":"MoALD subsidy circular, 2026 Long Rains, participating wards annex","checkedAt":"2026-08-14T00:00:00Z"}},
    {"id":"stock_available","label":"Assigned depot has stock available","test":"stock_available","param":null,
     "evidence":{"authority":"reported","derivation":"direct","sourceId":"ncpb-depot-list","citation":"NCPB depot stock reports","checkedAt":null}}
  ],
  "allocationFormula": {"bagsPerAcre": 2, "maxBags": 10},
  "participatingWards": ["Ng'araria","Muruka","Kagundu-ini","Gaichanjiru","Ithiru","Ruchu"]
}
$json$::jsonb)
on conflict(id) do update set slug=excluded.slug, name=excluded.name, organization=excluded.organization, status=excluded.status, start_date=excluded.start_date, end_date=excluded.end_date, metadata=excluded.metadata;

-- --- price schedule (Kenya Gazette price notice, official/direct) -----------
insert into public.subsidy_prices(id,programme_id,input_type,subsidized_price_kes,market_price_kes,bag_weight_kg,bags_per_acre,allocation_bags_max,valid_from,valid_to,source_id,classification) values
('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000201','planting_fertilizer',2500,6500,50,2,10,'2026-08-14','2026-12-31','00000000-0000-0000-0000-000000000102','official')
on conflict(id) do update set subsidized_price_kes=excluded.subsidized_price_kes, market_price_kes=excluded.market_price_kes, bag_weight_kg=excluded.bag_weight_kg, bags_per_acre=excluded.bags_per_acre, allocation_bags_max=excluded.allocation_bags_max, valid_from=excluded.valid_from, valid_to=excluded.valid_to, source_id=excluded.source_id, classification=excluded.classification;

-- --- depots (infrastructure_assets) -----------------------------------------
-- ncpb-sagana is the one official depot (official/direct). The three
-- agro-dealers are SIMULATED (reported/simulated) demo fixtures; their metadata
-- says so and every consumer must label them.
insert into public.infrastructure_assets(id,area_id,source_id,name,asset_type,status,location,metadata)
select v.id::uuid, a.id, v.source_id::uuid, v.name, v.asset_type, 'operational',
       extensions.st_setsrid(extensions.st_makepoint(v.lon,v.lat),4326)::extensions.geography,
       v.metadata::jsonb
from (values
  ('00000000-0000-0000-0000-000000000301','county','kirinyaga','00000000-0000-0000-0000-000000000103','NCPB Sagana Depot','ncpb_depot',37.20,-0.66,
   '{"slug":"ncpb-sagana","stock_status":"in_stock","checked_at":"2026-09-02T06:00:00Z","merchant":"National Cereals and Produce Board","evoucher":true,"classification":"official","authority":"official","derivation":"direct"}'),
  ('00000000-0000-0000-0000-000000000302','ward','muruka','00000000-0000-0000-0000-000000000105','Kabati Agrovet','agro_dealer',36.98,-0.90,
   '{"slug":"kabati-agrovet","stock_status":"unknown","checked_at":null,"merchant":"Kabati Agrovet (synthetic)","evoucher":true,"classification":"simulated","authority":"reported","derivation":"simulated"}'),
  ('00000000-0000-0000-0000-000000000303','ward','kagundu-ini','00000000-0000-0000-0000-000000000105','Kagundu-ini Farm Supplies','agro_dealer',36.94,-0.93,
   '{"slug":"kagunduini-supplies","stock_status":"low","checked_at":"2026-09-01T14:00:00Z","merchant":"Kagundu-ini Farm Supplies (synthetic)","evoucher":true,"classification":"simulated","authority":"reported","derivation":"simulated"}'),
  ('00000000-0000-0000-0000-000000000304','county','murang-a','00000000-0000-0000-0000-000000000105','Kenol Agro Centre','agro_dealer',37.12,-0.99,
   '{"slug":"kenol-agro","stock_status":"in_stock","checked_at":"2026-09-02T05:30:00Z","merchant":"Kenol Agro Centre (synthetic)","evoucher":true,"classification":"simulated","authority":"reported","derivation":"simulated"}')
) as v(id,area_level,area_slug,source_id,name,asset_type,lon,lat,metadata)
join public.administrative_areas a on a.level=v.area_level and a.slug=v.area_slug
on conflict(id) do update set area_id=excluded.area_id, source_id=excluded.source_id, name=excluded.name, asset_type=excluded.asset_type, status=excluded.status, location=excluded.location, metadata=excluded.metadata;

-- --- farmer tokens (SYNTHETIC, NO PII) ---------------------------------------
-- K-001 confirmed-eligible | K-002 missing id_linked | K-003 over acreage cap |
-- K-004 rules pass but assigned depot stock is unknown => the sijui case
-- (conclusion indicated_by_published_rules). attributes.inFarmerRegister may
-- also be the string "unknown" => engine returns cannot_determine.
insert into public.farmer_tokens(id,token_code,ward_area_id,state,assigned_depot_id,attributes,classification)
select v.id::uuid, v.token_code, a.id, v.state, v.depot_id::uuid, v.attributes::jsonb, 'simulated'
from (values
  ('00000000-0000-0000-0000-000000000601','K-001','ng-araria','registered','00000000-0000-0000-0000-000000000301',
   '{"inFarmerRegister":true,"nationalIdLinked":true,"acreage":2,"crop":"maize","priorRedemptions":0}'),
  ('00000000-0000-0000-0000-000000000602','K-002','muruka','missing_requirement','00000000-0000-0000-0000-000000000302',
   '{"inFarmerRegister":true,"nationalIdLinked":false,"acreage":1.5,"crop":"maize","priorRedemptions":0}'),
  ('00000000-0000-0000-0000-000000000603','K-003','gaichanjiru','ineligible','00000000-0000-0000-0000-000000000303',
   '{"inFarmerRegister":true,"nationalIdLinked":true,"acreage":7.5,"crop":"maize","priorRedemptions":0}'),
  ('00000000-0000-0000-0000-000000000604','K-004','ithiru','registered','00000000-0000-0000-0000-000000000302',
   '{"inFarmerRegister":true,"nationalIdLinked":true,"acreage":3,"crop":"maize","priorRedemptions":0}')
) as v(id,token_code,ward_slug,state,depot_id,attributes)
join public.administrative_areas a on a.level='ward' and a.slug=v.ward_slug
on conflict(token_code) do update set ward_area_id=excluded.ward_area_id, state=excluded.state, assigned_depot_id=excluded.assigned_depot_id, attributes=excluded.attributes, classification=excluded.classification;

-- --- evidence records: one per headline claim --------------------------------
-- Official claims are 'verified' (readable by anon under RLS); the simulated
-- unknown-stock claim stays 'unverified' by design — it is the sijui evidence.
insert into public.evidence_records(id,source_id,area_id,claim,value,valid_from,valid_to,confidence,verification_status,locator) values
('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000102',null,
 'Subsidized planting fertilizer costs KES 2,500 per 50 kg bag for the 2026 Long Rains season (market reference ~KES 6,500).',
 '{"subsidized_price_kes":2500,"market_price_kes":6500,"bag_weight_kg":50}','2026-08-14T00:00:00Z','2026-12-31T23:59:59Z','high','verified',
 'Kenya Gazette price notice, effective 2026-08-14'),
('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000101',null,
 'Allocation is 2 subsidized bags per registered acre, capped at 10 bags per farmer per season.',
 '{"bagsPerAcre":2,"maxBags":10}','2026-08-14T00:00:00Z','2026-12-31T23:59:59Z','high','verified',
 'MoALD subsidy circular, 2026 Long Rains, allocation schedule'),
('00000000-0000-0000-0000-000000000404','00000000-0000-0000-0000-000000000103',null,
 'NCPB Sagana Depot stock status is in_stock, checked at 2026-09-02T06:00:00Z.',
 '{"depot":"ncpb-sagana","stock_status":"in_stock","checked_at":"2026-09-02T06:00:00Z"}','2026-09-02T06:00:00Z',null,'moderate','verified',
 'NCPB depot list, stock report 2026-09-02'),
('00000000-0000-0000-0000-000000000405','00000000-0000-0000-0000-000000000105',null,
 'Kabati Agrovet (simulated) has no verifiable stock report; stock status is unknown and cannot be confirmed today.',
 '{"depot":"kabati-agrovet","stock_status":"unknown","checked_at":null}',null,null,'unknown','unverified',
 'TerraMavuno synthetic depot fixture')
on conflict(id) do update set claim=excluded.claim, value=excluded.value, valid_from=excluded.valid_from, valid_to=excluded.valid_to, confidence=excluded.confidence, verification_status=excluded.verification_status, locator=excluded.locator;

insert into public.evidence_records(id,source_id,area_id,claim,value,valid_from,valid_to,confidence,verification_status,locator)
select '00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000101',k.id,
 'All six wards of Kandara constituency (Ng''araria, Muruka, Kagundu-ini, Gaichanjiru, Ithiru, Ruchu) participate in the National Fertilizer Subsidy Programme for the 2026 Long Rains season.',
 '{"participatingWards":["Ng''araria","Muruka","Kagundu-ini","Gaichanjiru","Ithiru","Ruchu"]}'::jsonb,
 '2026-08-14T00:00:00Z','2026-12-31T23:59:59Z','high','verified',
 'MoALD subsidy circular, 2026 Long Rains, participating wards annex'
from public.administrative_areas k where k.level='constituency' and k.slug='kandara'
on conflict(id) do update set area_id=excluded.area_id, claim=excluded.claim, value=excluded.value, confidence=excluded.confidence, verification_status=excluded.verification_status, locator=excluded.locator;

-- --- provenance: one 'seeded' event per entity group -------------------------
insert into public.provenance_events(entity_table,entity_id,action,source_id,transformation,metadata)
select v.entity_table, v.entity_id, 'seeded', '00000000-0000-0000-0000-000000000105',
       'supabase/seed.sql — KILIMO, NITAPATA? section',
       '{"season":"2026 Long Rains","programme":"ken-fert-subsidy-2026"}'::jsonb
from (values
  ('data_sources','kilimo:sources'),
  ('administrative_areas','kilimo:muranga-kandara-wards'),
  ('programmes','kilimo:ken-fert-subsidy-2026'),
  ('subsidy_prices','kilimo:price-schedule-2026-long-rains'),
  ('infrastructure_assets','kilimo:depots'),
  ('farmer_tokens','kilimo:tokens-k001-k004'),
  ('evidence_records','kilimo:headline-claims')
) as v(entity_table,entity_id)
where not exists (
  select 1 from public.provenance_events p
  where p.entity_table=v.entity_table and p.entity_id=v.entity_id and p.action='seeded'
);
-- === end KILIMO, NITAPATA? seed ===
