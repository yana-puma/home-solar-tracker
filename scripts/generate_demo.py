#!/usr/bin/env python3
"""Generate an invented house/garden GLB using only Python's standard library.

No survey, address, imagery, private geometry, or external asset is used.
Viewer axes: meters, Y up, -Z north, -X east. Output is deterministic.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
REVISION = 'fictional-1'


def generate_demo(root: Path = ROOT):
    materials = []
    meshes = []
    nodes = []
    accessors = []
    views = []
    binary = bytearray()

    def shape(name, vertices, faces, color):
        positions, normals = [], []
        for a, b, c in faces:
            p, q, r = vertices[a], vertices[b], vertices[c]
            u, v = [q[i] - p[i] for i in range(3)], [r[i] - p[i] for i in range(3)]
            cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
            length = math.sqrt(sum(x*x for x in cross)) or 1
            for point in [p, q, r]:
                positions.extend(point); normals.extend(x/length for x in cross)
        indices = []
        for data, is_position in [(positions, True), (normals, False)]:
            offset = len(binary)
            binary.extend(struct.pack('<' + 'f'*len(data), *data))
            views.append({'buffer':0, 'byteOffset':offset, 'byteLength':len(data)*4, 'target':34962})
            accessor = {'bufferView':len(views)-1, 'componentType':5126, 'count':len(data)//3, 'type':'VEC3'}
            if is_position:
                accessor['min'] = [min(data[i::3]) for i in range(3)]
                accessor['max'] = [max(data[i::3]) for i in range(3)]
            accessors.append(accessor); indices.append(len(accessors)-1)
        materials.append({'pbrMetallicRoughness':{'baseColorFactor':[*color,1], 'metallicFactor':0, 'roughnessFactor':.9},'doubleSided':True})
        meshes.append({'name':name,'primitives':[{'attributes':{'POSITION':indices[0],'NORMAL':indices[1]},'material':len(materials)-1}]})
        nodes.append({'mesh':len(meshes)-1,'name':name})

    def box(name, center, size, color):
        vertices = [[center[0]+x*size[0]/2, center[1]+y*size[1]/2, center[2]+z*size[2]/2] for x,y,z in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        faces = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(3,7,6),(3,6,2),(0,4,7),(0,7,3),(1,2,6),(1,6,5)]
        shape(name,vertices,faces,color)

    def cone(name, x, y, z, radius, height, color):
        vertices=[[x,y+height,z],[x,y,z]] + [[x+radius*math.cos(i*math.pi/6),y,z+radius*math.sin(i*math.pi/6)] for i in range(12)]
        faces=[]
        for i in range(12):
            j=(i+1)%12
            faces.extend([(0,2+i,2+j),(1,2+j,2+i)])
        shape(name,vertices,faces,color)

    box('Invented house',[0,2.5,0],[12,5,8],[.83,.70,.51])
    shape('Invented gabled roof',[[-6.5,5,-4.5],[6.5,5,-4.5],[-6.5,5,4.5],[6.5,5,4.5],[-6.5,8,0],[6.5,8,0]],[(0,1,5),(0,5,4),(2,4,5),(2,5,3),(0,4,2),(1,3,5),(0,2,3),(0,3,1)],[.28,.32,.38])
    for x in [-4,0,4]:
        for z in [-4.03,4.03]:
            box('Invented window',[x,3,z],[1.5,1.5,.06],[.35,.62,.72])
    box('Invented door',[2,1.2,4.08],[1.5,2.4,.12],[.30,.36,.30])
    box('Invented patio',[0,-.04,6.5],[8,.08,4],[.69,.65,.57])
    box('Invented garden bed A',[-9,-.025,4],[3,.05,5],[.44,.28,.15])
    box('Invented garden bed B',[4,-.025,12],[5,.05,3],[.44,.28,.15])
    for x,z in [(-12,-5),(-11,-12),(11,5)]:
        box('Invented tree trunk',[x,2,z],[.5,4,.5],[.33,.22,.13])
        cone('Invented tree canopy',x,2,z,2.7,6,[.15,.38,.22])
        cone('Invented tree crown',x,4,z,2,5,[.22,.47,.25])
    box('Invented fence',[14,1,-2],[.15,2,18],[.52,.43,.32])
    document={'asset':{'version':'2.0','generator':'Home Solar Tracker fictional primitive generator'},'scene':0,'scenes':[{'nodes':list(range(len(nodes)))}], 'nodes':nodes,'meshes':meshes,'materials':materials,'accessors':accessors,'bufferViews':views,'buffers':[{'byteLength':len(binary)}]}
    text=json.dumps(document,separators=(',',':')).encode();text+=b' '*((-len(text))%4)
    glb=struct.pack('<4sII',b'glTF',2,12+8+len(text)+8+len(binary))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(binary),0x004e4942)+binary
    model_path=root/'properties/demo/model.glb';model_path.parent.mkdir(parents=True,exist_ok=True);model_path.write_bytes(glb)
    config={'$schema':'../../schemas/property.schema.v2.json','schemaVersion':2,'package':{'id':'demo','label':'Fictional house and garden','revision':REVISION,'description':'Invented primitive geometry; not a reconstruction of any actual house. Coordinates are a coarse hypothetical study location.'},'location':{'latitude':40,'longitude':-80,'timeZone':'America/New_York','displayLabel':'Fictional sample garden','precision':'regional'},'assets':[{'id':'model','type':'model','url':'model.glb','size':len(glb),'integrity':'sha256-'+base64.b64encode(hashlib.sha256(glb).digest()).decode()}],'model':{'assetId':'model','units':'meters','scale':1,'northOffsetDegrees':0,'position':[0,0,0]},'scene':{'groundBounds':{'minX':-20,'maxX':20,'minZ':-20,'maxZ':20},'terrainProfile':[],'cameraPresets':{'overview':{'label':'Garden overview','position':[-30,25,35],'target':[0,1,0]},'top':{'label':'Garden plan','position':[0,50,.01],'target':[0,0,0]}}},'zones':[{'id':'east-bed','title':'Garden bed A','purpose':'garden','surface':'ground','elevation':0,'geometry':{'type':'rectangle','minX':-10.5,'maxX':-7.5,'minZ':1.5,'maxZ':6.5},'sunlightThresholds':{'minimumDailyHours':6}},{'id':'south-bed','title':'Garden bed B','purpose':'garden','surface':'ground','elevation':0,'geometry':{'type':'rectangle','minX':1.5,'maxX':6.5,'minZ':10.5,'maxZ':13.5},'sunlightThresholds':{'minimumDailyHours':6}},{'id':'patio','title':'Patio','purpose':'patio','surface':'ground','elevation':0,'geometry':{'type':'rectangle','minX':-4,'maxX':4,'minZ':4.5,'maxZ':8.5}}],'solar':{'defaultDate':'today','samplingMinutes':30,'exposureMethod':'raycast'},'privacy':{'visibility':'public','showAddress':False,'showExactLocation':False}}
    write_json(root/'properties/demo/property.json', config)
    write_json(root/'properties/index.json',{'schemaVersion':1,'defaultProperty':'demo','properties':[{'slug':'demo','title':'Fictional house and garden','displayLabel':'Fictional sample garden','revision':REVISION,'configUrl':'./demo/property.json','modelUrl':'./demo/model.glb','privacyTier':'public','updatedAt':'2026-10-07T00:00:00Z'}]})
    return model_path


def write_json(path, document):
    path.write_text(json.dumps(document,indent=2)+'\n',encoding='utf-8')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT,help='Output project root')
    args=parser.parse_args()
    print(f'Generated fictional sample: {generate_demo(args.root)}')
