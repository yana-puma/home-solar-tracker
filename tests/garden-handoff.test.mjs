import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateZoneExposure, zoneExposurePresentation } from '../src/viewer/zone-analysis.js';
import { loadedPropertyEntry, fitPropertyCamera } from '../src/viewer/property-scene.js';
import { packageReadiness } from '../src/configurator-readiness.js';

test('garden details use the area mean and target; no preset hours leak before calculation', () => {
  const zone={id:'garden',surface:'ground',purpose:'garden',geometry:{type:'rectangle',minX:0,maxX:4,minZ:0,maxZ:2}, sunlightThresholds:{minimumDailyHours:6,preferredTimeWindow:{start:'09:00',end:'17:00'}}};
  assert.equal(zoneExposurePresentation(zone).key,null);
  const result=aggregateZoneExposure({zones:[zone],exposure:{exposures:[{point:{x:1,z:1},sunMinutes:120},{point:{x:3,z:1},sunMinutes:480},{point:{x:20,z:20},sunMinutes:720}]}});
  const display=zoneExposurePresentation(zone,result.zones.garden);
  assert.equal(result.zones.garden.sunMinutes,300);
  assert.equal(display.key,'part_sun');
  assert.match(display.hoursText,/5.0 hrs/);
  assert.match(display.qualification,/Below the 6-hour/);
  assert.match(display.qualification,/time window is not assessed/);
});

test('elevated gardens, windows, and PV cannot inherit ground exposure',()=>{
  const zones=[{id:'bed',surface:'raised-bed',purpose:'garden'},{id:'window',purpose:'window'},{id:'pv',purpose:'pv'}];
  const results=aggregateZoneExposure({zones,exposure:{exposures:[{point:{x:0,z:0},sunMinutes:720}]}});
  for(const zone of zones){assert.equal(results.zones[zone.id].sunMinutes,null);assert.equal(zoneExposurePresentation(zone,results.zones[zone.id]).key,null);}
});

test('direct and local studies retain loaded identity and get a fitted overview',()=>{
  const property={package:{id:'own-house',revision:'2',label:'Own house'},location:{displayLabel:'Example region'}};
  const entry=loadedPropertyEntry(property,{slug:'demo',revision:'1'},{direct:true});
  assert.equal(entry.slug,'own-house');assert.equal(entry.revision,'2');
  const camera=fitPropertyCamera({minX:100,maxX:140,minZ:200,maxZ:260});
  assert.deepEqual(camera.target,[120,0,230]);
  assert.ok(camera.position[1]>=40);
});

test('complete-study readiness rejects missing preview, failing QA, and unchecked calibration',()=>{
  const ready={schemaValid:true,modelLoaded:true,calibration:{status:'pass'},reviewed:true,privacyReady:true};
  assert.equal(packageReadiness(ready).ready,true);
  for(const change of [{modelLoaded:false},{schemaValid:false},{calibration:{status:'fail'}},{reviewed:false},{privacyReady:false}])assert.equal(packageReadiness({...ready,...change}).ready,false);
  assert.equal(packageReadiness({...ready,calibration:{status:'warn'}}).ready,true);
});
