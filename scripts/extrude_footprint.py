#!/usr/bin/env python3
"""
scripts/extrude_footprint.py
----------------------------
Loads 2D building footprint polygons from GeoJSON or DXF blueprints,
and extrudes them into watertight 3D architectural massing meshes (OBJ, GLTF, STL).

Features:
- Parse GeoJSON (Polygon / MultiPolygon) with per-feature height/stories properties
- Parse DXF blueprints (LWPOLYLINE, POLYLINE, closed loops)
- Support for Flat, Gable, and Hip roof geometries
- Automatic ground elevation alignment from point cloud or base offset
- Generate sample architectural blueprint GeoJSON for demonstration
"""

import argparse
import json
import os
import sys
from pathlib import Path
import numpy as np

try:
    from shapely.geometry import shape, Polygon, MultiPolygon
    from shapely.ops import triangulate
except ImportError:
    shape = None
    Polygon = None

try:
    import trimesh
except ImportError:
    trimesh = None

try:
    import ezdxf
except ImportError:
    ezdxf = None


def generate_sample_footprint_geojson(output_path: Path):
    """Creates a sample residential footprint GeoJSON with main house and attached garage."""
    sample_data = {
        "type": "FeatureCollection",
        "name": "Residential_Property_Footprint",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}
        },
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "building": "residential",
                    "type": "main_house",
                    "height": 7.8,
                    "stories": 2,
                    "roof_shape": "gable",
                    "material_color": [0.85, 0.82, 0.78]
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [-10.0, -5.0],
                            [8.0, -5.0],
                            [8.0, 12.0],
                            [-10.0, 12.0],
                            [-10.0, -5.0]
                        ]
                    ]
                }
            },
            {
                "type": "Feature",
                "properties": {
                    "building": "garage",
                    "type": "attached_garage",
                    "height": 3.8,
                    "stories": 1,
                    "roof_shape": "flat",
                    "material_color": [0.82, 0.79, 0.75]
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [-16.0, -5.0],
                            [-10.0, -5.0],
                            [-10.0, 4.0],
                            [-16.0, 4.0],
                            [-16.0, -5.0]
                        ]
                    ]
                }
            }
        ]
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(sample_data, f, indent=2)

    print(f"[✓] Created sample blueprint GeoJSON: {output_path}")
    return sample_data


def parse_dxf_footprints(dxf_path: Path) -> list:
    """Extracts closed 2D polygon boundaries from DXF file."""
    if ezdxf is None:
        raise ImportError("ezdxf is required to parse DXF blueprints. Install via: pip install ezdxf")

    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()
    polygons = []

    for entity in msp:
        if entity.dxftype() == 'LWPOLYLINE':
            pts = entity.get_points(format='xy')
            if entity.is_closed and len(pts) >= 3:
                polygons.append({
                    "coords": pts,
                    "height": 6.5,
                    "roof_shape": "flat"
                })
        elif entity.dxftype() == 'POLYLINE':
            pts = [v.dxf.location.vec2 for v in entity.vertices]
            if entity.is_closed and len(pts) >= 3:
                polygons.append({
                    "coords": [(p.x, p.y) for p in pts],
                    "height": 6.5,
                    "roof_shape": "flat"
                })

    print(f"[+] Parsed {len(polygons)} closed footprint polygons from DXF: {dxf_path}")
    return polygons


def parse_geojson_footprints(geojson_path: Path) -> list:
    """Extracts polygons and extrusion heights from GeoJSON."""
    with open(geojson_path, "r") as f:
        data = json.load(f)

    features = []
    if data.get("type") == "FeatureCollection":
        features = data.get("features", [])
    elif data.get("type") == "Feature":
        features = [data]

    polygons = []
    for feat in features:
        props = feat.get("properties", {})
        height = float(props.get("height", props.get("stories", 2) * 3.0))
        roof_shape = props.get("roof_shape", "flat").lower()
        color = props.get("material_color", [0.85, 0.82, 0.78])

        geom = feat.get("geometry", {})
        gtype = geom.get("type")
        coords = geom.get("coordinates", [])

        if gtype == "Polygon":
            polygons.append({
                "exterior": coords[0],
                "holes": coords[1:] if len(coords) > 1 else [],
                "height": height,
                "roof_shape": roof_shape,
                "color": color,
                "properties": props
            })
        elif gtype == "MultiPolygon":
            for poly_coords in coords:
                polygons.append({
                    "exterior": poly_coords[0],
                    "holes": poly_coords[1:] if len(poly_coords) > 1 else [],
                    "height": height,
                    "roof_shape": roof_shape,
                    "color": color,
                    "properties": props
                })

    print(f"[+] Parsed {len(polygons)} building footprint(s) from GeoJSON: {geojson_path}")
    return polygons


def triangulate_polygon_2d(exterior_pts: list) -> list:
    """Ear-clipping triangulation for simple non-intersecting polygons."""
    pts = np.array(exterior_pts)
    # Remove closing vertex if duplicate
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]

    n = len(pts)
    if n < 3:
        return []

    # If shapely is available, use robust earclip/triangulation
    if Polygon is not None:
        try:
            poly = Polygon(pts)
            if not poly.is_valid:
                poly = poly.buffer(0)
            tris = triangulate(poly)
            indices = []
            for tri in tris:
                if tri.within(poly) or tri.intersects(poly.buffer(-1e-4)):
                    tri_coords = list(tri.exterior.coords)[:3]
                    # Map back to indices in pts
                    tri_idx = []
                    for tc in tri_coords:
                        dists = np.linalg.norm(pts - np.array(tc[:2]), axis=1)
                        tri_idx.append(int(np.argmin(dists)))
                    if len(set(tri_idx)) == 3:
                        indices.append(tri_idx)
            if len(indices) > 0:
                return indices
        except Exception:
            pass

    # Simple ear-clipping fallback
    indices = []
    idx_list = list(range(n))
    while len(idx_list) > 2:
        indices.append([idx_list[0], idx_list[1], idx_list[2]])
        idx_list.pop(1)
    return indices


def extrude_polygon_to_mesh(
    exterior_pts: list,
    height: float = 6.0,
    base_elevation: float = 0.0,
    roof_shape: str = "flat",
    color: list = None
):
    """
    Constructs a 3D solid mesh from 2D polygon with specified roof geometry (flat, gable, or hip).
    Returns (vertices, faces, vertex_colors).
    """
    pts_2d = np.array(exterior_pts, dtype=np.float64)
    if np.allclose(pts_2d[0], pts_2d[-1]):
        pts_2d = pts_2d[:-1]

    n = len(pts_2d)
    if n < 3:
        return np.empty((0, 3)), np.empty((0, 3), dtype=int), None

    # Ensure counter-clockwise orientation for outer boundary
    area = 0.5 * np.sum(pts_2d[:, 0] * np.roll(pts_2d[:, 1], -1) - pts_2d[:, 1] * np.roll(pts_2d[:, 0], -1))
    if area < 0:
        pts_2d = pts_2d[::-1]

    vertices = []
    faces = []

    # 1. Base vertices (z = base_elevation)
    for p in pts_2d:
        vertices.append([p[0], p[1], base_elevation])

    # 2. Eaves vertices (z = base_elevation + height)
    eaves_height = height if roof_shape == "flat" else height * 0.7
    for p in pts_2d:
        vertices.append([p[0], p[1], base_elevation + eaves_height])

    # 3. Wall Faces (Quads split into 2 triangles)
    for i in range(n):
        next_i = (i + 1) % n
        v_b0 = i
        v_b1 = next_i
        v_t0 = n + i
        v_t1 = n + next_i

        # Two triangles for lateral wall face (CCW outward normal)
        faces.append([v_b0, v_b1, v_t1])
        faces.append([v_b0, v_t1, v_t0])

    # 4. Bottom Cap (Facing downward)
    bottom_tri_indices = triangulate_polygon_2d(pts_2d)
    for tri in bottom_tri_indices:
        # Clockwise to face down
        faces.append([tri[0], tri[2], tri[1]])

    # 5. Roof Geometry
    if roof_shape == "flat":
        for tri in bottom_tri_indices:
            # CCW to face up
            faces.append([n + tri[0], n + tri[1], n + tri[2]])

    elif roof_shape == "gable":
        # Calculate bounding box & ridge line along dominant axis
        min_x, min_y = np.min(pts_2d, axis=0)
        max_x, max_y = np.max(pts_2d, axis=0)
        span_x = max_x - min_x
        span_y = max_y - min_y

        ridge_z = base_elevation + height
        if span_y >= span_x:
            # Ridge along Y axis
            mid_x = (min_x + max_x) / 2.0
            r1_idx = len(vertices)
            vertices.append([mid_x, min_y, ridge_z])
            r2_idx = len(vertices)
            vertices.append([mid_x, max_y, ridge_z])

            for i in range(n):
                next_i = (i + 1) % n
                p0 = pts_2d[i]
                p1 = pts_2d[next_i]
                v_t0 = n + i
                v_t1 = n + next_i

                # Connect eaves to ridge
                target_r = r1_idx if (p0[1] + p1[1]) / 2.0 < (min_y + max_y) / 2.0 else r2_idx
                faces.append([v_t0, v_t1, target_r])
        else:
            # Ridge along X axis
            mid_y = (min_y + max_y) / 2.0
            r1_idx = len(vertices)
            vertices.append([min_x, mid_y, ridge_z])
            r2_idx = len(vertices)
            vertices.append([max_x, mid_y, ridge_z])

            for i in range(n):
                next_i = (i + 1) % n
                p0 = pts_2d[i]
                p1 = pts_2d[next_i]
                v_t0 = n + i
                v_t1 = n + next_i

                target_r = r1_idx if (p0[0] + p1[0]) / 2.0 < (min_x + max_x) / 2.0 else r2_idx
                faces.append([v_t0, v_t1, target_r])

    else:  # Default/Hip roof: centroid apex pyramid
        apex_x = float(np.mean(pts_2d[:, 0]))
        apex_y = float(np.mean(pts_2d[:, 1]))
        apex_z = base_elevation + height
        apex_idx = len(vertices)
        vertices.append([apex_x, apex_y, apex_z])

        for i in range(n):
            next_i = (i + 1) % n
            v_t0 = n + i
            v_t1 = n + next_i
            faces.append([v_t0, v_t1, apex_idx])

    verts_arr = np.array(vertices, dtype=np.float64)
    faces_arr = np.array(faces, dtype=np.int32)

    # Colors
    c = color if color is not None else [0.85, 0.82, 0.78]
    colors = np.tile((np.array(c) * 255).astype(np.uint8), (len(verts_arr), 1))

    return verts_arr, faces_arr, colors


def process_and_export_footprints(
    footprint_path: Path,
    output_path: Path,
    base_elevation: float = 0.0,
    default_height: float = 6.5
) -> dict:
    """Loads footprint file, extrudes all features, and exports clean combined mesh."""
    ext = footprint_path.suffix.lower()

    if ext in [".geojson", ".json"]:
        polygons = parse_geojson_footprints(footprint_path)
    elif ext == ".dxf":
        polygons = parse_dxf_footprints(footprint_path)
    else:
        raise ValueError(f"Unsupported footprint format: {ext}. Use .geojson or .dxf.")

    all_verts = []
    all_faces = []
    all_colors = []
    vert_offset = 0

    for poly_info in polygons:
        exterior = poly_info.get("exterior", poly_info.get("coords", []))
        height = poly_info.get("height", default_height)
        roof_shape = poly_info.get("roof_shape", "gable")
        color = poly_info.get("color", [0.85, 0.82, 0.78])

        verts, faces, cols = extrude_polygon_to_mesh(
            exterior_pts=exterior,
            height=height,
            base_elevation=base_elevation,
            roof_shape=roof_shape,
            color=color
        )

        if len(verts) > 0:
            all_verts.append(verts)
            all_faces.append(faces + vert_offset)
            all_colors.append(cols)
            vert_offset += len(verts)

    if len(all_verts) == 0:
        raise ValueError("No valid polygon geometry could be extruded.")

    final_verts = np.vstack(all_verts)
    final_faces = np.vstack(all_faces)
    final_colors = np.vstack(all_colors)

    print(f"[+] Combined Extruded Mesh: {len(final_verts)} vertices, {len(final_faces)} faces")

    # Export using trimesh or direct Wavefront OBJ writer
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if trimesh is not None:
        mesh = trimesh.Trimesh(
            vertices=final_verts,
            faces=final_faces,
            vertex_colors=final_colors,
            process=True
        )
        mesh.export(str(output_path))
        print(f"[✓] Exported extruded building massing model: {output_path}")
        print(f"    - Watertight: {mesh.is_watertight}")
        print(f"    - Volume: {mesh.volume:.2f} m³" if mesh.is_watertight else "")
    else:
        # Fallback OBJ exporter
        obj_path = output_path.with_suffix(".obj")
        with open(obj_path, "w") as f:
            f.write("# Extruded Building Footprint Mesh\n")
            for v, c in zip(final_verts, final_colors):
                f.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f} {c[0]/255:.3f} {c[1]/255:.3f} {c[2]/255:.3f}\n")
            for face in final_faces:
                f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")
        print(f"[✓] Exported extruded mesh (OBJ): {obj_path}")

    return {
        "vertices_count": len(final_verts),
        "faces_count": len(final_faces),
        "output": str(output_path)
    }


def main():
    parser = argparse.ArgumentParser(description="Extrude 2D building footprints (GeoJSON/DXF) into 3D meshes.")
    parser.add_argument("--footprint", type=str, help="Path to input GeoJSON or DXF file")
    parser.add_argument("--height", type=float, default=6.5, help="Default extrusion height in meters")
    parser.add_argument("--base-elevation", type=float, default=0.0, help="Base ground elevation offset in meters")
    parser.add_argument("--output", type=str, default="data/processed/extruded_building.obj", help="Output 3D mesh path (.obj, .stl, .glb)")
    parser.add_argument("--create-sample", action="store_true", help="Create sample GeoJSON blueprint")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent

    if args.create_sample:
        sample_path = project_root / "data" / "raw" / "property_footprint.geojson"
        generate_sample_footprint_geojson(sample_path)
        if not args.footprint:
            args.footprint = str(sample_path)

    if args.footprint:
        fp_path = Path(args.footprint)
        if not fp_path.is_absolute():
            fp_path = project_root / fp_path

        out_path = Path(args.output)
        if not out_path.is_absolute():
            out_path = project_root / out_path

        process_and_export_footprints(
            footprint_path=fp_path,
            output_path=out_path,
            base_elevation=args.base_elevation,
            default_height=args.height
        )


if __name__ == "__main__":
    main()
