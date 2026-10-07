import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateSerializableExposure} from '../src/exposure.js';
import {aggregateZoneExposure} from '../src/viewer/zone-analysis.js';

// Decode the generator's unindexed, untransformed triangle primitives, independent of Three.js.
function triangles(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),jsonSize=view.getUint32(12,true);
  const document=JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+jsonSize)));
  const binaryOffset=28+jsonSize, result=[];
  for(const mesh of document.meshes)for(const primitive of mesh.primitives){
    const accessor=document.accessors[primitive.attributes.POSITION],buffer=document.bufferViews[accessor.bufferView];
    for(let i=0;i<accessor.count*3;i++)result.push(view.getFloat32(binaryOffset+buffer.byteOffset+i*4,true));
  }
  return new Float64Array(result);
}

test('fictional sample garden is usable: ground beds are not blocked by their own floor patches',async()=>{
  const config=JSON.parse(await readFile(new URL('../properties/demo/property.json',import.meta.url),'utf8'));
  const bytes=new Uint8Array(await readFile(new URL('../properties/demo/model.glb',import.meta.url)));
  const result=await calculateSerializableExposure({tier:'standard',propertyRevision:config.package.revision,modelHash:config.assets[0].integrity,date:'2026-06-21',...config.location,grid:{bounds:config.scene.groundBounds,columns:20,rows:28},occlusion:{type:'triangle-soup',triangles:triangles(bytes)}});
  const zones=aggregateZoneExposure({zones:config.zones,exposure:result});
  for(const id of ['east-bed','south-bed','patio']){
    assert.ok(zones.zones[id].sunMinutes>120,`${id} should get some direct sun in this invented yard`);
    assert.ok(zones.zones[id].sunMinutes<=960);
  }
});
