import test from 'node:test';
import assert from 'node:assert/strict';
import { CCPMB_COMMUNES, insideCcpmb, clipPathsToCcpmb, ccpmbLongitudeSpans, filterCcpmbPoints } from '../lib/ccpmb-territory.ts';

const square = (x1,y1,x2,y2) => [[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]];
test('official territory contains exactly the ten CCPMB communes and excludes neighbours', () => {
  assert.deepEqual(CCPMB_COMMUNES.map(c=>c.code).sort(),['74083','74085','74089','74099','74103','74173','74208','74215','74236','74256']);
  for (const point of [[45.8378,6.5717],[45.8225,6.7267],[45.914,6.648],[45.935,6.62]]) assert.ok(insideCcpmb(...point));
  for (const point of [[45.93,6.762],[45.924,6.87],[45.89,6.798],[46.083,6.723],[46.082,6.541],[NaN,6.6]]) assert.equal(insideCcpmb(...point),false);
});
test('clips crossing segments at polygon boundaries with both endpoints outside', () => {
  assert.deepEqual(clipPathsToCcpmb([[[1,-1],[1,3]]],[[square(0,0,2,2)]]),[[[1,0],[1,2]]]);
  assert.deepEqual(clipPathsToCcpmb([[[3,-1],[3,3]]],[[square(0,0,2,2)]]),[]);
});
test('union retains shared commune borders but never bridges gaps or polygon holes', () => {
  assert.deepEqual(clipPathsToCcpmb([[[1,-1],[1,5]]],[[square(0,0,2,2)],[square(2,0,4,2)]]),[[[1,0],[1,2],[1,4]]]);
  assert.deepEqual(clipPathsToCcpmb([[[1,-1],[1,5]]],[[square(0,0,1,2)],[square(3,0,4,2)]]),[[[1,0],[1,1]],[[1,3],[1,4]]]);
  assert.deepEqual(clipPathsToCcpmb([[[2,-1],[2,5]]],[[square(0,0,4,4),square(1,1,3,3)]]),[[[2,0],[2,1]],[[2,3],[2,4]]]);
});
test('collinear boundary and disconnected paths are handled without joining them', () => {
  const polygons=[[square(0,0,2,2)]];
  assert.deepEqual(clipPathsToCcpmb([[[0,-1],[0,3]]],polygons),[[[0,0],[0,2]]]);
  assert.deepEqual(clipPathsToCcpmb([[[1,0],[1,1]],[[1,1],[1,2]]],polygons),[[[1,0],[1,1]],[[1,1],[1,2]]]);
});
test('scanline raster mask respects holes and the union of adjacent communes', () => {
  assert.deepEqual(ccpmbLongitudeSpans(2,[[square(0,0,4,4),square(1,1,3,3)]]),[[0,1],[3,4]]);
  assert.deepEqual(ccpmbLongitudeSpans(1,[[square(0,0,2,2)],[square(2,0,4,2)]]),[[0,4]]);
  assert.deepEqual(ccpmbLongitudeSpans(3,[[square(0,0,2,2)]]),[]);
});
test('point filtering preserves source objects and excludes neighbouring communes', () => {
  const inside={id:'passy',lat:45.923535,lng:6.713642,reading:12.9};
  const outside={id:'servoz',lat:45.93,lng:6.762,reading:20};
  const source=Object.freeze([Object.freeze(inside),Object.freeze(outside)]);
  const result=filterCcpmbPoints(source);
  assert.deepEqual(result,[inside]);
  assert.equal(result[0],inside);
  assert.equal(source.length,2);
});
