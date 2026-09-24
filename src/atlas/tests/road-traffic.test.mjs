import test from 'node:test';
import assert from 'node:assert/strict';
import { clipTrafficPaths, trafficColor, trafficValue, TRAFFIC_ROADS } from '../lib/road-traffic.ts';
import { parseRoadTraffic, loadRoadTraffic, roadTrafficUrl } from '../lib/road-traffic-source.ts';

test('traffic colours use consistent volume classes; missing counts are never zero or green', () => {
  assert.equal(trafficColor(0),'#15803d');
  assert.equal(trafficColor(2499),'#15803d');
  assert.equal(trafficColor(2500),'#65a30d');
  assert.equal(trafficColor(5000),'#d97706');
  assert.equal(trafficColor(10000),'#ea580c');
  assert.equal(trafficColor(20000),'#b91c1c');
  for (const v of [null,-1,NaN,Infinity]) assert.equal(trafficColor(v),'#64748b');
  assert.match(trafficValue(null),/non disponible/);
  assert.match(trafficValue(0),/^0 véhicules/);
  assert.deepEqual(TRAFFIC_ROADS,['A40','D1205','D909','D1212','D13','D39','D902','D339','N205']);
});
const bounds = {west:0,east:2,south:0,north:2};
test('clips crossing road geometry even if both endpoints lie outside the atlas', () => {
  assert.deepEqual(clipTrafficPaths([[[1,-1],[1,3]]],bounds),[[[1,0],[1,2]]]);
  assert.deepEqual(clipTrafficPaths([[[-1,1],[3,1]]],bounds),[[[0,1],[2,1]]]);
  assert.deepEqual(clipTrafficPaths([[[3,-1],[3,3]]],bounds),[]);
  assert.deepEqual(clipTrafficPaths([[[1,1],[1,1]]],bounds),[]);
});
test('clipping never joins different roads or disconnected visits to the map bounds', () => {
  const paths = clipTrafficPaths([[[1,1],[1,3],[3,3],[3,1],[1,1]],[[0.5,0.5],[1,0.5]]],bounds);
  assert.deepEqual(paths,[[[1,1],[1,2]],[[2,1],[1,1]],[[0.5,0.5],[1,0.5]]]);
});

const member = ({road='A40',id='CAP9',tmja='29492',prior='30000',points='45.914 6.648 45.915 6.649',extra=''}={}) => `<gml:featureMember><ms:L_RESEAU_TRAFIC_ROUTIER_L_074><ms:geometry><gml:MultiCurve srsName="EPSG:4326"><gml:curveMember><gml:LineString><gml:posList srsDimension="2">${points}</gml:posList></gml:LineString></gml:curveMember></gml:MultiCurve></ms:geometry><ms:N_ROUTE>${road}</ms:N_ROUTE><ms:T_COMPT>CAP</ms:T_COMPT><ms:N_COMPT>9</ms:N_COMPT><ms:ID>${id}</ms:ID><ms:TMJA_23>${prior}</ms:TMJA_23><ms:TMJA_24>${tmja}</ms:TMJA_24><ms:PCT_PL_24>6.58</ms:PCT_PL_24>${extra}</ms:L_RESEAU_TRAFIC_ROUTIER_L_074></gml:featureMember>`;
const collection = (...members) => `<wfs:FeatureCollection>${members.join('')}</wfs:FeatureCollection>`;
test('GML import keeps annual counts, correct latitude/longitude order, exact road selection and source IDs', () => {
  const data=parseRoadTraffic(collection(member(),member({road:'D909A'}),member({road:'D13',id:'CDP11',tmja:'1415'})),2026);
  assert.equal(data.year,2024);
  assert.equal(data.segments.length,2);
  assert.equal(data.segments[0].vehicles,29492);
  assert.equal(data.segments[0].sourceId,'CAP9');
  assert.deepEqual(data.segments[0].paths,[[[45.914,6.648],[45.915,6.649]]]);
  assert.equal(data.segments[0].heavyVehiclesPercent,6.58);
});
test('D339 and N205 are included without adding neighbouring routes or out-of-territory sections', () => {
  const data=parseRoadTraffic(collection(
    member({road:'D339',id:'D339-IN',tmja:'10530'}),
    member({road:'N205',id:'N205-IN',tmja:'18628'}),
    member({road:'N205',id:'N205-OUT',points:'45.93 6.762 45.932 6.764'}),
    member({road:'D1506',id:'OTHER'}),
    member({road:'D339A',id:'SUFFIX'}),
  ),2026);
  assert.deepEqual(data.segments.map(s=>[s.road,s.sourceId,s.vehicles]),[
    ['D339','D339-IN',10530],['N205','N205-IN',18628],
  ]);
});
test('latest common year never borrows older counts or counts for a different vehicle category', () => {
  for (const tmja of ['0','-99','','NC','NaN','Infinity']) {
    const data=parseRoadTraffic(collection(member({tmja,extra:'<ms:TMJA_PL_25>1900</ms:TMJA_PL_25>'})),2026);
    assert.equal(data.year,2024);
    assert.equal(data.segments[0].vehicles,null);
    assert.equal(data.segments[0].heavyVehiclesPercent,null);
  }
  const data=parseRoadTraffic(collection(member({extra:'<ms:TMJA_25>31000</ms:TMJA_25>'}),member({road:'D13',id:'CDP11'})),2026);
  assert.equal(data.year,2025);
  assert.equal(data.segments[0].vehicles,31000);
  assert.equal(data.segments[1].vehicles,null);
});
test('unidentified geometries get stable distinct IDs and out-of-area lines are excluded', () => {
  const a=member({id:'X'}),b=member({id:'X',points:'45.935 6.62 45.936 6.63'});
  const data=parseRoadTraffic(collection(a,b,member({points:'47 7 48 8'})),2026);
  assert.equal(data.segments.length,2);
  assert.notEqual(data.segments[0].id,data.segments[1].id);
  assert.equal(data.segments[0].id,parseRoadTraffic(collection(b,a),2026).segments[1].id);
  assert.equal(data.segments[0].sourceId,null);
});
test('roads in Servoz and Chamonix are excluded even inside the provider query rectangle', () => {
  const data=parseRoadTraffic(collection(member(),member({id:'SERVOZ',points:'45.93 6.762 45.932 6.764'}),member({id:'CHAMONIX',points:'45.924 6.87 45.925 6.872'})),2026);
  assert.equal(data.segments.length,1);
  assert.equal(data.segments[0].sourceId,'CAP9');
});
test('changed CRS, axes, geometry, duplicate and truncated exports fail closed', () => {
  for (const xml of [
    collection(member()).replace('EPSG:4326','EPSG:2154'),
    collection(member({points:'6.5 45.9 6.6 45.95'})),
    collection(member({points:'45.9 6.5 45.95'})),
    collection(member()).replace('srsDimension="2"','srsDimension="3"'),
    collection(member()).slice(0,-10), collection(member(),member()),
    '<ServiceExceptionReport>Unavailable</ServiceExceptionReport>',
    '<!DOCTYPE xml>'+collection(member()),
  ]) assert.throws(()=>parseRoadTraffic(xml,2026));
  assert.throws(()=>parseRoadTraffic(collection(...Array.from({length:1000},()=>member())),2026));
});
test('loader uses verified WFS1.1 axis order and returns empty explicit error on provider failure', async () => {
  const url=new URL(roadTrafficUrl());
  assert.equal(url.searchParams.get('VERSION'),'1.1.0');
  assert.equal(url.searchParams.get('BBOX'),'45.7,6.45,46.1,7.1,urn:ogc:def:crs:EPSG::4326');
  const good=await loadRoadTraffic(async()=>new Response(collection(member())));
  assert.equal(good.segments.length,1);
  assert.ok(good.fetchedAt);
  const bad=await loadRoadTraffic(async()=>new Response('Unavailable',{status:503}));
  assert.deepEqual(bad.segments,[]);
  assert.equal(bad.fetchedAt,null);
  assert.ok(bad.error);
});
