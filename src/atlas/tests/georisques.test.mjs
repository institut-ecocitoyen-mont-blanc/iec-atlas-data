import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSoilGeometry, parseSoilRecords, groupSoilRecords, loadGeorisques, georisquesUrl, georisquesWfsUrl, loadGeorisquesWfs } from '../lib/georisques-source.ts';
import { insideCcpmb } from '../lib/ccpmb-territory.ts';
import { soilRecordColor } from '../lib/georisques.ts';
import { installationsUrl, parseInstallations, loadInstallations } from '../lib/georisques-installations.ts';

const row = { identifiant_ssp: 'SSP000066501', nom_etablissement: 'COTTERLAZ-CARRAT', nom: 'COTTERLAZ-CARRAT', code_insee: '74208', nom_commune: 'PASSY', adresse: 'Rue de la Centrale', statut: 'En cours', date_maj: '2017-05-22', fiche_risque: 'https://fiches-risques.brgm.fr/georisques/infosols/instruction/SSP000066501', geom: { type: 'Point', coordinates: [6.726, 45.919] } };
const sis = { ...row, identifiant_ssp: 'SSP00006650101', id_sis: '74SIS02337', statut_classification: 'Secteurs d’information sur les sols', date_maj: '2020-09-30', fiche_risque: 'https://fiches-risques.brgm.fr/georisques/infosols/classification/SSP00006650101' };
const square = (w,s,e,n) => [[w,s],[e,s],[e,n],[w,n],[w,s]];
test('clips polygons to the union, including holes and disconnected portions', () => {
  const territory = [[square(0,0,4,4), square(1,1,2,2)], [square(6,0,8,4)]];
  const geometry = clipSoilGeometry({ type: 'Polygon', coordinates: [square(-1,-1,9,5)] }, territory);
  assert.equal(geometry.type, 'MultiPolygon');
  assert.equal(geometry.coordinates.length, 2);
  assert.equal(insideCcpmb(1.5,1.5,geometry.coordinates), false);
  assert.equal(insideCcpmb(1,5,geometry.coordinates), false);
  assert.equal(insideCcpmb(1,7,geometry.coordinates), true);
  for (const polygon of geometry.coordinates) for (const [x,y] of polygon[0]) assert.ok(insideCcpmb(y,x,territory));
  assert.equal(clipSoilGeometry({ type: 'Point', coordinates: [1.5,1.5] }, territory), null);
});

const wfsFeature = (kind) => ({ type: 'Feature', properties: { code_metier: kind === 'sis' ? 'SSP00006650101' : row.identifiant_ssp, code_insee: row.code_insee, nom_commune: row.nom_commune, nom_etablissement: row.nom_etablissement, adresse: row.adresse, ...(kind === 'sis' ? { id_inventaire_classification: '74SIS02337', date_saisie_commune: '2015-01-01' } : { statut_instruction: row.statut, date_maj: row.date_maj }) }, geometry: row.geom });
function wfsFetcher(url) {
  const q = new URL(url).searchParams;
  const layer = q.get('TYPENAMES');
  const features = layer.endsWith('POLYGONE') ? [] : [wfsFeature(layer.includes('SIS') ? 'sis' : 'instruction')];
  if (q.get('RESULTTYPE') === 'hits') return Response.json(null, { status: 500 });
  return Response.json({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features });
}
const completeWfs = async (url) => {
  const q = new URL(url).searchParams;
  if (q.get('RESULTTYPE') === 'hits') return new Response(`<wfs:FeatureCollection numberMatched="${q.get('TYPENAMES').endsWith('POLYGONE') ? 0 : 1}" numberReturned="0"/>`);
  return wfsFetcher(url);
};
test('uses complete official WFS without first calling the broken REST gateway or fabricating SIS metadata', async () => {
  let restCalls = 0;
  const data = await loadGeorisques(async url => {
    if (new URL(url).pathname.endsWith('/installations_classees')) return Response.json({ results:0, page:1, total_pages:0, next:null, data:[] });
    if (new URL(url).pathname.includes('/api/')) { restCalls++; return new Response('', { status: 503 }); } return completeWfs(url);
  });
  assert.equal(restCalls, 0);
  assert.deepEqual(data.errors, []);
  assert.equal(data.transport, 'wfs+rest');
  assert.equal(data.sites.length, 1);
  assert.equal(data.sites[0].records.length, 2);
  const sector = data.sites[0].records.find(r => r.kind === 'sis');
  assert.equal(sector.updatedAt, '');
  assert.equal(sector.status, '');
  assert.equal(sector.sisId, '74SIS02337');
  assert.match(sector.url, /classification\/SSP00006650101$/);
});
test('WFS uses explicit latitude/longitude bbox but requires CRS84 longitude/latitude JSON', async () => {
  const url = new URL(georisquesWfsUrl('SSP_INSTR_GE_POINT'));
  assert.equal(url.searchParams.get('VERSION'), '2.0.0');
  assert.ok(Number(url.searchParams.get('BBOX').split(',')[0]) > 45);
  await assert.rejects(loadGeorisquesWfs(async url => {
    const response = await completeWfs(url);
    if (new URL(url).searchParams.has('RESULTTYPE')) return response;
    const data = await response.json(); data.crs.properties.name = 'EPSG:2154';
    return Response.json(data);
  }), /CRS/);
});
test('WFS refuses truncated, oversized, duplicate and partly unavailable catalogues', async () => {
  for (const fail of ['truncated', 'oversized', 'duplicate', 'unavailable']) {
    await assert.rejects(loadGeorisquesWfs(async url => {
      const q = new URL(url).searchParams;
      if (q.get('RESULTTYPE') === 'hits' && fail !== 'unavailable') return new Response(`<wfs:FeatureCollection numberMatched="${fail === 'oversized' ? 1001 : 2}"/>`);
      if (fail === 'unavailable' && q.get('TYPENAMES').includes('SIS')) return new Response('', { status: 500 });
      if (fail === 'duplicate' && !q.has('RESULTTYPE')) { const data = await (await completeWfs(url)).json(); data.features = [wfsFeature('instruction'), wfsFeature('instruction')]; return Response.json(data); }
      return completeWfs(url);
    }));
  }
});
test('soil records preserve status, dates and real source identities without outside markers', () => {
  const sites = parseSoilRecords([row, { ...row, identifiant_ssp: 'SSP123', code_insee: '74266' }, { ...row, identifiant_ssp: 'SSP456', geom: { type: 'Point', coordinates: [6.87,45.92] } }], 'instruction');
  assert.equal(sites.length, 1);
  assert.equal(sites[0].records[0].updatedAt, '2017-05-22');
  assert.equal(sites[0].records[0].status, 'En cours');
  assert.equal(sites[0].id, 'SSP000066501');
  assert.equal(soilRecordColor(sites[0]), '#925323');
});
test('groups exact same footprint and name while retaining both official dossiers', () => {
  const instructions = parseSoilRecords([row], 'instruction');
  const sectors = parseSoilRecords([sis], 'sis');
  const grouped = groupSoilRecords([...instructions,...sectors]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].records.length, 2);
  assert.equal(soilRecordColor(grouped[0]), '#7c3aed');
  assert.equal(instructions[0].records.length, 1, 'does not mutate source objects');
  assert.equal(groupSoilRecords([...instructions,{ ...sectors[0], name: 'Different site' }]).length, 2);
});
test('rejects malformed geometry, duplicate IDs and unsafe source links', () => {
  assert.throws(() => parseSoilRecords([row,row], 'instruction'));
  for (const geom of [null,{ type: 'Point', coordinates: [null,45] },{ type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1]]] }]) assert.throws(() => clipSoilGeometry(geom));
  assert.throws(() => parseSoilRecords([{...row,fiche_risque:'javascript:alert(1)'}], 'instruction'));
});
test('requests all ten communes, follows pages and preserves a working source on partial outage', async () => {
  assert.equal(new URL(georisquesUrl('sis')).searchParams.get('code_insee').split(',').length, 10);
  const calls=[];
  const result = await loadGeorisques(async url => {
    const u = new URL(url); calls.push(u);
    if(u.pathname.endsWith('installations_classees')) return Response.json({ results:0,page:1,total_pages:0,next:null,data:[] });
    if(u.pathname.endsWith('conclusions_sis')) return new Response('',{status:500});
    const page=Number(u.searchParams.get('page'));
    return Response.json({ results:2,page,total_pages:2,next:page===1?'unused':null,data:[page===1?row:{...row,identifiant_ssp:'SSP123',nom_etablissement:'Second dossier'}] });
  });
  assert.equal(result.sites.length,2); assert.equal(result.errors.length,1); assert.ok(result.fetchedAt);
  assert.ok(calls.some(u=>u.searchParams.get('page')==='2'));
  const failed=await loadGeorisques(async()=>Response.json({ results:10,page:1,total_pages:1,next:null,data:[row] }));
  assert.equal(failed.sites.length,0); assert.equal(failed.errors.length,3); assert.equal(failed.fetchedAt,null);
});

const installation = { codeAIOT:'0003204031', raisonSociale:'PUGNAT Frères TP', codeInsee:'74208', commune:'Passy', adresse1:"Bordure d’Arve", longitude:6.692092, latitude:45.921347, regime:'Non ICPE', etatActivite:null, statutSeveso:null, serviceAIOT:'DREAL AURA', date_maj:'2026-04-26/10-21-48', inspections:[{dateInspection:'2021-06-15'}] };
test('retains Non ICPE, published coordinates and distinct inspection/update dates', () => {
  const { sites, coverage } = parseInstallations([installation]);
  assert.equal(sites.length,1);
  assert.deepEqual(coverage, {total:1,mapped:1,missingCoordinates:0,outsideTerritory:0});
  assert.deepEqual(sites[0].geometry.coordinates,[6.692092,45.921347]);
  assert.equal(sites[0].id,'AIOT0003204031');
  const record = sites[0].records[0];
  assert.equal(record.regime,'Non ICPE'); assert.equal(record.status,''); assert.equal(record.seveso,'');
  assert.equal(record.updatedAt,'2026-04-26'); assert.equal(record.lastInspectionAt,'2021-06-15');
  assert.equal(record.url,'https://www.georisques.gouv.fr/risques/installations/donnees/details/0003204031');
  assert.equal(soilRecordColor(sites[0]),'#247184');
});
test('installations enforce the ten communes and boundary without guessing missing locations', () => {
  const result = parseInstallations([installation,
    {...installation,codeAIOT:'0003204032',codeInsee:'74143'},
    {...installation,codeAIOT:'0003204033',longitude:null},
    {...installation,codeAIOT:'0003204034',longitude:6.87,latitude:45.92},
  ]);
  assert.deepEqual(result.coverage,{total:3,mapped:1,missingCoordinates:1,outsideTerritory:1});
  assert.throws(()=>parseInstallations([installation,installation]),/dupliquée/);
  assert.throws(()=>parseInstallations([{...installation,longitude:'6.69'}]),/Coordonnées/);
  assert.throws(()=>parseInstallations([{...installation,codeAIOT:'javascript:alert(1)'}]));
});
test('installations follow every page, never arbitrary next URLs, and verify total counts', async () => {
  const query = new URL(installationsUrl()).searchParams;
  assert.equal(query.get('code_insee').split(',').length,10);
  assert.ok(!query.get('code_insee').split(',').includes('74143'));
  const calls=[];
  const result=await loadInstallations(async url=>{
    calls.push(url); const page=Number(new URL(url).searchParams.get('page'));
    return Response.json({results:2,page,total_pages:2,next:page===1?'https://untrusted.example/':null,data:[{...installation,codeAIOT:page===1?'0003204031':'0003204032'}]});
  });
  assert.equal(result.sites.length,2);
  assert.ok(calls.every(url=>url.startsWith('https://www.georisques.gouv.fr/api/')));
  for (const body of [
    {results:2,page:1,total_pages:1,next:null,data:[installation]},
    {results:2,page:1,total_pages:11,next:'next',data:[installation]},
    {results:2,page:1,total_pages:2,next:'next',data:[]},
    {results:1,page:1,total_pages:1,next:'next',data:[installation]},
  ]) await assert.rejects(loadInstallations(async()=>Response.json(body)));
  await assert.rejects(loadInstallations(async()=>new Response('',{status:500})));
});
test('an installations failure makes the combined export incomplete, preserving last-good eligibility', async () => {
  const data=await loadGeorisques(async url=> new URL(url).pathname.endsWith('/installations_classees') ? new Response('',{status:503}) : completeWfs(url));
  assert.equal(data.sites.length,1);
  assert.equal(data.errors.length,1);
  assert.match(data.errors[0],/installations/);
});
