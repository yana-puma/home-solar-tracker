#!/usr/bin/env python3
"""
scripts/pipeline.py
-------------------
Master Automated Pipeline for 3D Property Modeling.

Coordinates:
1. Data Ingestion: USGS 3DEP API / Local LAS / LAZ / Demo Generator
2. Blueprint Extrusion: 2D GeoJSON / DXF architectural massing
3. Point Cloud Processing: SOR filtering, classification & Surface Reconstruction (Poisson / DSM Delaunay)
4. Optimization & Repair: Quadric decimation, watertight base solidification
5. Multi-Format Export: .obj, .gltf, .glb, .stl
6. Interactive Visualization: Launch Three.js / Open3D viewer

Usage:
  python scripts/pipeline.py --demo
  python scripts/pipeline.py --input-las data/raw/survey.las --footprint data/raw/footprint.geojson
  python scripts/pipeline.py --bbox "-105.28,39.99,-105.26,40.01" --watertight
"""

import argparse
import os
import sys
import time
from pathlib import Path

# Add scripts directory to path for direct imports
scripts_dir = Path(__file__).resolve().parent
if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))

import fetch_elevation
import extrude_footprint
import process_pointcloud
from package_property import create_property_package


def run_pipeline(
    input_las: str = None,
    bbox: str = None,
    footprint: str = None,
    output_dir: str = "output",
    model_name: str = "property_model",
    reconstruction_method: str = "auto",
    target_faces: int = 50000,
    voxel_size: float = 0.25,
    watertight: bool = True,
    is_demo: bool = False,
    launch_viz: bool = False,
    viz_mode: str = "web",
    property_slug: str = None,
    property_title: str = None,
    latitude: float = None,
    longitude: float = None,
    time_zone: str = None,
    display_label: str = "Private property",
    north_offset: float = 0.0,
):
    start_time = time.time()
    if property_slug and bbox:
        raise ValueError("Bounding-box elevation sampling produces terrain only, not a house or shade-obstruction model. Supply a real LAS/LAZ survey or package a calibrated GLB.")
    if property_slug and is_demo:
        raise ValueError("Synthetic demo geometry cannot be packaged as a real property. Run --demo separately and label its output fictional.")
    if not input_las and not bbox and not is_demo:
        raise ValueError("Supply --input-las or --bbox, or choose --demo explicitly for fictional data.")
    project_root = scripts_dir.parent

    # Setup directories
    fetch_elevation.create_directory_structure(project_root)
    out_dir_path = project_root / output_dir
    out_dir_path.mkdir(parents=True, exist_ok=True)

    print("\n" + "=" * 65)
    print(" 🏡  AUTOMATED 3D PROPERTY MODELING PIPELINE")
    print("=" * 65)

    # ---------------------------------------------------------
    # Step 1: Data Ingestion / Point Cloud Acquisition
    # ---------------------------------------------------------
    print("\n[STEP 1/4] Ingesting Elevation & Spatial Data...")
    raw_pc_path = project_root / "data" / "raw" / "property_raw.las"

    if input_las:
        las_p = Path(input_las)
        if not las_p.is_absolute():
            las_p = project_root / las_p
        fetch_elevation.ingest_local_las(las_p, raw_pc_path)
    elif bbox:
        bbox_coords = [float(x.strip()) for x in bbox.split(",")]
        fetch_elevation.query_usgs_3dep(bbox_coords, raw_pc_path)
    else:
        # Default / Demo mode
        print("[*] Running in Demo mode: generating high-density residential LiDAR survey...")
        fetch_elevation.generate_synthetic_residential_cloud(raw_pc_path)

    # ---------------------------------------------------------
    # Step 2: Blueprint & Footprint Integration (Optional / Demo)
    # ---------------------------------------------------------
    footprint_mesh_path = None
    if is_demo and not footprint:
        sample_geojson = project_root / "data" / "raw" / "property_footprint.geojson"
        extrude_footprint.generate_sample_footprint_geojson(sample_geojson)
        footprint = str(sample_geojson)

    if footprint:
        print("\n[STEP 2/4] Processing 2D Architectural Blueprints & Extrusion...")
        fp_path = Path(footprint)
        if not fp_path.is_absolute():
            fp_path = project_root / fp_path
        footprint_mesh_path = project_root / "data" / "processed" / "building_extruded.obj"
        extrude_footprint.process_and_export_footprints(
            footprint_path=fp_path,
            output_path=footprint_mesh_path,
            base_elevation=0.0
        )

    # ---------------------------------------------------------
    # Step 3: Point Cloud Processing & Surface Reconstruction
    # ---------------------------------------------------------
    print("\n[STEP 3/4] Point Cloud Filtering & 3D Surface Reconstruction...")
    # Resolve PLY fallback if LAS was written as PLY
    if not raw_pc_path.exists() and raw_pc_path.with_suffix(".ply").exists():
        raw_pc_path = raw_pc_path.with_suffix(".ply")

    points, colors, classification = process_pointcloud.load_point_cloud(raw_pc_path)

    clean_points, clean_colors, classification = process_pointcloud.filter_and_classify_points(
        points=points,
        colors=colors,
        classification=classification,
        voxel_size=voxel_size
    )

    # Surface Reconstruction
    method = reconstruction_method
    if method == "auto":
        # If open3d is available, use screened poisson; otherwise delaunay
        method = "poisson" if process_pointcloud.o3d is not None else "delaunay"

    if method == "poisson":
        verts, faces, vcols = process_pointcloud.reconstruct_surface_poisson(
            points=clean_points,
            colors=clean_colors,
            depth=9
        )
    else:
        verts, faces, vcols = process_pointcloud.reconstruct_surface_dsm_delaunay(
            points=clean_points,
            colors=clean_colors,
            grid_resolution=0.5
        )

    # Watertight base extension for CAD/3D printing
    if watertight:
        verts, faces, vcols = process_pointcloud.make_mesh_watertight_base(verts, faces, vcols, skirt_depth=2.0)

    # ---------------------------------------------------------
    # Step 4: Optimization, Decimation & Multi-Format Export
    # ---------------------------------------------------------
    print("\n[STEP 4/4] Optimizing Topology & Exporting Production Formats...")
    export_dict = process_pointcloud.optimize_and_export_mesh(
        vertices=verts,
        faces=faces,
        vertex_colors=vcols,
        output_dir=out_dir_path,
        base_name=model_name,
        target_faces=target_faces,
        export_formats=["obj", "glb", "gltf", "stl"]
    )

    if property_slug:
        missing = [
            name
            for name, value in (
                ("property_title", property_title),
                ("latitude", latitude),
                ("longitude", longitude),
                ("time_zone", time_zone),
            )
            if value is None or (isinstance(value, str) and not value.strip())
        ]
        if missing:
            raise ValueError(
                "property packaging requires: " + ", ".join(missing)
            )
        glb_path = export_dict.get("glb")
        if not glb_path or not Path(glb_path).is_file():
            raise RuntimeError("property packaging requires a successful GLB export")
        package_dir = create_property_package(
            slug=property_slug,
            title=property_title,
            model=glb_path,
            latitude=latitude,
            longitude=longitude,
            time_zone=time_zone,
            display_label=display_label,
            north_offset=north_offset,
            output_root=project_root / "properties",
        )
        export_dict["property_package"] = str(package_dir)

    elapsed = time.time() - start_time
    print("\n" + "=" * 65)
    print(f"✨  PIPELINE COMPLETE in {elapsed:.2f} seconds!")
    print("=" * 65)
    print("📁  Generated 3D Output Assets:")
    for fmt, path in export_dict.items():
        print(f"    - [{fmt.upper()}]: {path}")
    print("=" * 65)

    # Optional Visualization
    if launch_viz:
        import visualize
        primary_model = out_dir_path / f"{model_name}.glb"
        if not primary_model.exists():
            primary_model = out_dir_path / f"{model_name}.obj"
        if viz_mode == "desktop":
            visualize.launch_open3d_viewer(primary_model)
        else:
            visualize.launch_web_viewer(project_root, primary_model)

    return export_dict


def main():
    parser = argparse.ArgumentParser(description="End-to-end automated 3D property modeling pipeline.")
    parser.add_argument("--demo", action="store_true", help="Run full pipeline demo with synthetic LiDAR & footprint")
    parser.add_argument("--input-las", type=str, help="Path to input LAS/LAZ point cloud")
    parser.add_argument("--bbox", type=str, help="USGS 3DEP Bounding box: min_lon,min_lat,max_lon,max_lat")
    parser.add_argument("--footprint", type=str, help="2D building blueprint file (.geojson or .dxf)")
    parser.add_argument("--output-dir", type=str, default="output", help="Directory to save exported 3D models")
    parser.add_argument("--name", type=str, default="property_model", help="Base name for output model files")
    parser.add_argument("--method", choices=["poisson", "delaunay", "auto"], default="auto", help="Reconstruction algorithm")
    parser.add_argument("--target-faces", type=int, default=50000, help="Target face count for quadric decimation")
    parser.add_argument("--voxel-size", type=float, default=0.25, help="Voxel size in meters for downsampling")
    parser.add_argument("--watertight", action="store_true", default=True, help="Create watertight base block")
    parser.add_argument("--visualize", action="store_true", help="Launch 3D visualizer upon completion")
    parser.add_argument("--viz-mode", choices=["web", "desktop"], default="web", help="Visualization mode")
    parser.add_argument("--property-slug", help="Create a shareable property package with this slug")
    parser.add_argument("--property-title", help="Public title for the packaged property")
    parser.add_argument("--latitude", type=float, help="Property latitude used for solar calculations")
    parser.add_argument("--longitude", type=float, help="Property longitude used for solar calculations")
    parser.add_argument("--time-zone", help="IANA time zone, for example America/New_York")
    parser.add_argument("--display-label", default="Private property", help="Privacy-safe public location label")
    parser.add_argument("--north-offset", type=float, default=0.0, help="Model rotation from true north in degrees")

    args = parser.parse_args()

    if args.property_slug:
        missing_flags = [
            flag
            for flag, value in (
                ("--property-title", args.property_title),
                ("--latitude", args.latitude),
                ("--longitude", args.longitude),
                ("--time-zone", args.time_zone),
            )
            if value is None or (isinstance(value, str) and not value.strip())
        ]
        if missing_flags:
            parser.error("--property-slug requires " + ", ".join(missing_flags))

    if not args.demo and not args.input_las and not args.bbox:
        parser.error("Supply --input-las or --bbox, or choose --demo explicitly.")
    is_demo = args.demo

    run_pipeline(
        input_las=args.input_las,
        bbox=args.bbox,
        footprint=args.footprint,
        output_dir=args.output_dir,
        model_name=args.name,
        reconstruction_method=args.method,
        target_faces=args.target_faces,
        voxel_size=args.voxel_size,
        watertight=args.watertight,
        is_demo=is_demo,
        launch_viz=args.visualize,
        viz_mode=args.viz_mode,
        property_slug=args.property_slug,
        property_title=args.property_title,
        latitude=args.latitude,
        longitude=args.longitude,
        time_zone=args.time_zone,
        display_label=args.display_label,
        north_offset=args.north_offset,
    )


if __name__ == "__main__":
    main()
