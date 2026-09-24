import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatePrecision, groundwaterCatalogueUrl, groundwaterAnalysisUrl, parseGroundwaterStations, parseGroundwaterAnalyses, groundwaterResultLabel, groundwaterResultUnit, loadGroundwaterAnalyses } from '../lib/groundwater.ts';
import { loadGroundwaterCatalogue } from '../lib/groundwater-source.ts';

const rawStation={bss_id:'BSS001SGTA',code_bss:'06796X0029/S089A',code_insee:'74089',nom_commune:'Cordon',longitude:6.6077324992609645,latitude:45.91800600594568,precision_coordonnees:18,nom_nature_pe:'Source',date_fin_mesure:'2024-11-26'};
const station=parseGroundwaterStations([rawStation])[0];
const raw={bss_id:station.id,code_insee_actuel:'74089',date_debut_prelevement:'2024-11-26T08:53:00Z',code_param:1112,nom_param:'Benfluraline',resultat:0.005,symbole_unite:'µg/L',code_remarque_analyse:2,nom_remarque_analyse:'Résultat < seuil de détection',nom_qualification:'Correcte',nom_statut_analyse:'Donnée contrôlée niveau 1',nom_fraction:'Eau brute'};
const envelope=(data)=>({data,count:data.length,next:null});
test('uses documented filter names and clips to both commune and polygon', () => {
  const url=new URL(groundwaterCatalogueUrl());
  assert.equal(url.searchParams.get('code_commune').split(',').length,10);
  assert.equal(url.searchParams.has('code_insee'),false);
  const analysisUrl=new URL(groundwaterAnalysisUrl(station.id));
  assert.equal(analysisUrl.searchParams.get('bss_id'),station.id);
  assert.equal(analysisUrl.searchParams.get('sort'),'desc');
  assert.equal(parseGroundwaterStations([rawStation,{...rawStation,bss_id:'BSSOUT',code_insee:'74266'},{...rawStation,bss_id:'BSSOUT2',longitude:6.87,latitude:45.92}]).length,1);
  assert.equal(parseGroundwaterStations([{...rawStation,latitude:null}]).length,0);
  assert.throws(()=>parseGroundwaterStations([rawStation,rawStation]));
});
test('precision metadata and catalogue dates are not upgraded to precise or current measurements', () => {
  assert.match(coordinatePrecision(station.precision),/Chef-lieu/);
  assert.match(coordinatePrecision(0),/non renseignée/);
  assert.match(coordinatePrecision(17),/Centroïde/);
  assert.equal(station.lastMeasurement,'2024-11-26');
  assert.deepEqual(parseGroundwaterAnalyses(envelope([]),station),{analyses:[],total:0,more:false});
});
test('preserves numeric zero, bounds, categorical results, missing values and units separately', () => {
  const analysis=parseGroundwaterAnalyses(envelope([raw]),station).analyses[0];
  assert.equal(groundwaterResultLabel(analysis),'< 0,005');
  assert.equal(groundwaterResultUnit(analysis),'µg/L');
  for(const code of [2,7,9,10]) assert.equal(groundwaterResultLabel({...analysis,remarkCode:code}),'< 0,005');
  for(const code of [3,8]) assert.equal(groundwaterResultLabel({...analysis,remarkCode:code}),'> 0,005');
  assert.equal(groundwaterResultLabel({...analysis,remarkCode:1,value:0}),'0');
  assert.equal(groundwaterResultLabel({...analysis,value:null}),'Non renseigné');
  assert.equal(groundwaterResultLabel({...analysis,remarkCode:0}),'Analyse non faite');
  assert.equal(groundwaterResultLabel({...analysis,remarkCode:4,value:1}),'Présence');
  assert.equal(groundwaterResultLabel({...analysis,remarkCode:4,value:2}),'Absence');
  assert.equal(groundwaterResultUnit({...analysis,remarkCode:4}),'');
  assert.equal(analysis.qualification,'Correcte');
  assert.equal(analysis.status,'Donnée contrôlée niveau 1');
  assert.equal(analysis.fraction,'Eau brute');
  assert.equal('quality' in analysis,false);
});
test('rejects misrouted/invalid data and labels incomplete windows without inventing history', () => {
  for(const changes of [{bss_id:'BSSOTHER'},{code_insee_actuel:'74266'},{date_debut_prelevement:null},{resultat:'garbage'}]) assert.throws(()=>parseGroundwaterAnalyses(envelope([{...raw,...changes}]),station));
  assert.throws(()=>parseGroundwaterAnalyses({data:[],count:200},station));
  const bounded=parseGroundwaterAnalyses({data:[raw],count:2565,next:'next-page'},station);
  assert.equal(bounded.analyses.length,1);assert.equal(bounded.more,true);assert.equal(bounded.total,2565);
});
test('catalogue follows pagination and fails closed on truncation or provider failure', async () => {
  const calls=[];
  const data=await loadGroundwaterCatalogue(async url=>{
    if(new URL(url).pathname.endsWith('/analyses')) return Response.json(envelope([{...raw,bss_id:new URL(url).searchParams.get('bss_id')}]));
    const page=Number(new URL(url).searchParams.get('page'));calls.push(page);
    return Response.json({count:2,next:page===1?'next':null,data:[page===1?rawStation:{...rawStation,bss_id:'BSSSECOND'}]});
  });
  assert.deepEqual(calls,[1,2]);assert.equal(data.stations.length,2);assert.ok(data.fetchedAt);
  const truncated=await loadGroundwaterCatalogue(async()=>Response.json({count:2,next:null,data:[rawStation]}));
  assert.deepEqual(truncated.stations,[]);assert.ok(truncated.error);
  const failed=await loadGroundwaterCatalogue(async()=>new Response('',{status:500}));
  assert.deepEqual(failed.stations,[]);assert.equal(failed.fetchedAt,null);assert.ok(failed.error);
});
test('only pins with verified analyses survive, regardless of catalogue dates or numeric zero', async () => {
  const stations=[rawStation,{...rawStation,bss_id:'BSS001SGSB',date_fin_mesure:'2026-05-21'},{...rawStation,bss_id:'BSSOLD',date_fin_mesure:null}];
  const data=await loadGroundwaterCatalogue(async url=>{
    const query=new URL(url);
    if(query.pathname.endsWith('/stations')) return Response.json(envelope(stations));
    assert.equal(query.searchParams.get('size'),'1');
    const id=query.searchParams.get('bss_id');
    return Response.json(envelope(id==='BSS001SGSB'?[]:[{...raw,bss_id:id,resultat:0}]));
  });
  assert.deepEqual(data.stations.map(s=>s.id),[station.id,'BSSOLD']);
  assert.equal(data.error,undefined);
});
test('availability probes are bounded and distinguish provider failures from confirmed empty data', async () => {
  const stations=Array.from({length:9},(_,i)=>({...rawStation,bss_id:`BSSTEST${i}`}));
  let active=0,maxActive=0;
  const data=await loadGroundwaterCatalogue(async url=>{
    const query=new URL(url);
    if(query.pathname.endsWith('/stations')) return Response.json(envelope(stations));
    active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,5));active--;
    const id=query.searchParams.get('bss_id');
    if(id==='BSSTEST0') return new Response('',{status:500});
    if(id==='BSSTEST1') return Response.json(envelope([{...raw,bss_id:'BSSWRONG'}]));
    if(id==='BSSTEST2') return Response.json({count:0});
    if(id==='BSSTEST3') return Response.json(envelope([]));
    return Response.json(envelope([{...raw,bss_id:id}]));
  });
  assert.equal(maxActive,4);
  assert.equal(data.stations.length,5);
  assert.match(data.error,/3 point\(s\)/);
  assert.match(data.error,/ne signifie pas une absence/);
});
test('analysis loader verifies identity even if the API ignores a filter', async(t)=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json(envelope([{...raw,bss_id:'BSSWRONG'}])));
  await assert.rejects(loadGroundwaterAnalyses(station,new AbortController().signal),/point sélectionné/);
});
