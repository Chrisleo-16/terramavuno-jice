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
