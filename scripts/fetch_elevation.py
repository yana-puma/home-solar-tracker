#!/usr/bin/env python3
"""
scripts/fetch_elevation.py
--------------------------
Data Ingestion & Integration module for USGS 3DEP elevation data,
local LAS/LAZ LiDAR point clouds, and synthetic demo terrain generation.

Features:
- Query USGS 3DEP Elevation Point Query Service (EPQS) & The National Map (TNM) API
- Ingest & re-center local LAS/LAZ files to local origin (0, 0, 0)
- Generate high-fidelity synthetic residential property point clouds for offline testing
- Export georeferencing metadata for downstream CAD / GIS integration
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path
import numpy as np

# Optional imports handled gracefully
try:
    import requests
except ImportError:
    requests = None

try:
    import laspy
except ImportError:
    laspy = None


def create_directory_structure(base_dir: Path):
    """Ensure data and output directories exist."""
    (base_dir / "data" / "raw").mkdir(parents=True, exist_ok=True)
    (base_dir / "data" / "processed").mkdir(parents=True, exist_ok=True)
    (base_dir / "output").mkdir(parents=True, exist_ok=True)


def generate_synthetic_residential_cloud(
    output_path: Path,
    property_width: float = 60.0,
    property_length: float = 60.0,
    point_density: float = 25.0,  # points per sq meter
) -> dict:
    """
    Generates a realistic 3D residential property point cloud:
    - Sloped & naturally noisy ground terrain
    - 2-story residential house with pitched/gable roof
    - Attached garage
    - Asphalt driveway & concrete walkway
    - Surrounding trees & shrubbery with volumetric canopy points
    - Standard LAS classification codes & RGB color channels
    """
    print(f"[*] Generating synthetic residential point cloud ({property_width}m x {property_length}m)...")
    np.random.seed(42)

    points_list = []
    colors_list = []
    classifications_list = []

    # 1. Ground Terrain Generation (Class 2: Ground)
    n_ground = int(property_width * property_length * point_density)
    gx = np.random.uniform(-property_width / 2, property_width / 2, n_ground)
    gy = np.random.uniform(-property_length / 2, property_length / 2, n_ground)
    # Gentle natural slope + Perlin-like micro-undulation
    gz = (
        0.04 * gx
        + 0.02 * gy
        + 0.3 * np.sin(gx / 6.0) * np.cos(gy / 6.0)
        + np.random.normal(0, 0.04, n_ground)
    )

    # Ground coloring: grassy green/earthy brown
    g_colors = np.zeros((n_ground, 3), dtype=np.uint8)
    for i in range(n_ground):
        # Driveway area check (X: -6 to 2, Y: -25 to -10)
        if -6 <= gx[i] <= 2 and -25 <= gy[i] <= -10:
            g_colors[i] = [70, 70, 75]  # Asphalt gray
            classifications_list.append(11)  # Road/Path
        # Walkway check
        elif -2 <= gx[i] <= 2 and -10 <= gy[i] <= 0:
            g_colors[i] = [180, 180, 185]  # Concrete
            classifications_list.append(11)
        else:
            variation = int(np.random.uniform(-15, 15))
            g_colors[i] = [
                np.clip(55 + variation, 0, 255),
                np.clip(115 + variation, 0, 255),
                np.clip(45 + variation, 0, 255),
            ]
            classifications_list.append(2)  # Ground

    for i in range(n_ground):
        points_list.append([gx[i], gy[i], gz[i]])
        colors_list.append(g_colors[i])

    # 2. Main Residential House (Class 6: Building)
    # Footprint: X from -10 to +8, Y from -5 to +12
    house_x_min, house_x_max = -10.0, 8.0
    house_y_min, house_y_max = -5.0, 12.0
    eaves_height = 5.8  # 2 stories
    ridge_height = 8.5
    house_cx = (house_x_min + house_x_max) / 2.0
    half_span = (house_x_max - house_x_min) / 2.0

    # Walls
    n_wall_pts = int(35 * point_density * eaves_height)
    for _ in range(n_wall_pts):
        side = np.random.choice([0, 1, 2, 3])
        z_frac = np.random.uniform(0, 1)
        z = z_frac * eaves_height
        if side == 0:  # South wall
            x = np.random.uniform(house_x_min, house_x_max)
            y = house_y_min
        elif side == 1:  # North wall
            x = np.random.uniform(house_x_min, house_x_max)
            y = house_y_max
        elif side == 2:  # West wall
            x = house_x_min
            y = np.random.uniform(house_y_min, house_y_max)
        else:  # East wall
            x = house_x_max
            y = np.random.uniform(house_y_min, house_y_max)

        # sample ground elevation at wall base
        base_z = 0.04 * x + 0.02 * y
        points_list.append([x + np.random.normal(0, 0.02), y + np.random.normal(0, 0.02), base_z + z])
        # Siding color (warm cream/beige)
        colors_list.append([215 + int(np.random.uniform(-10, 10)), 205 + int(np.random.uniform(-10, 10)), 190])
        classifications_list.append(6)

    # Pitched Gable Roof
    n_roof_pts = int((house_x_max - house_x_min) * (house_y_max - house_y_min) * point_density * 1.5)
    for _ in range(n_roof_pts):
        x = np.random.uniform(house_x_min - 0.4, house_x_max + 0.4)
        y = np.random.uniform(house_y_min - 0.4, house_y_max + 0.4)
        base_z = 0.04 * x + 0.02 * y

        # Gable pitch along X axis
        dist_from_ridge = abs(x - house_cx)
        roof_z = eaves_height + (ridge_height - eaves_height) * (1.0 - (dist_from_ridge / (half_span + 0.4)))
        roof_z = max(eaves_height, roof_z)

        points_list.append([x + np.random.normal(0, 0.02), y + np.random.normal(0, 0.02), base_z + roof_z])
        # Dark charcoal/slate roof tiles
        c = int(np.random.uniform(45, 65))
        colors_list.append([c, c + 2, c + 5])
        classifications_list.append(6)

    # 3. Attached Garage (X: -16 to -10, Y: -5 to 4, Height: 3.8m)
    garage_x_min, garage_x_max = -16.0, -10.0
    garage_y_min, garage_y_max = -5.0, 4.0
    garage_height = 3.8
    n_garage_pts = int(18 * point_density * garage_height)

    for _ in range(n_garage_pts):
        x = np.random.uniform(garage_x_min, garage_x_max)
        y = np.random.uniform(garage_y_min, garage_y_max)
        base_z = 0.04 * x + 0.02 * y
        is_roof = np.random.choice([True, False], p=[0.4, 0.6])
        if is_roof:
            z = base_z + garage_height + np.random.normal(0, 0.02)
            c = int(np.random.uniform(45, 65))
            colors_list.append([c, c + 2, c + 5])
        else:
            z = base_z + np.random.uniform(0, garage_height)
            colors_list.append([210, 200, 185])
        points_list.append([x, y, z])
        classifications_list.append(6)

    # 4. Trees & Foliage (Class 5: High Vegetation)
    tree_centers = [
        (-22.0, 18.0, 9.5, 4.5),  # (x, y, height, canopy_radius)
        (-18.0, -18.0, 8.0, 3.8),
        (20.0, 15.0, 11.0, 5.0),
        (22.0, -12.0, 7.5, 3.5),
        (12.0, 22.0, 6.5, 3.0),
    ]

    for tx, ty, th, tr in tree_centers:
        base_z = 0.04 * tx + 0.02 * ty
        n_tree_pts = int(350 * tr)
        # Trunk points
        for _ in range(int(n_tree_pts * 0.15)):
            tz = np.random.uniform(0, th * 0.4)
            points_list.append([tx + np.random.normal(0, 0.2), ty + np.random.normal(0, 0.2), base_z + tz])
            colors_list.append([90, 60, 35])  # Wood trunk
            classifications_list.append(5)

        # Canopy ellipsoid points
        canopy_base_z = base_z + th * 0.35
        for _ in range(int(n_tree_pts * 0.85)):
            u = np.random.uniform(0, 1)
            theta = np.random.uniform(0, 2 * math.pi)
            phi = np.random.uniform(0, math.pi)
            r = tr * (u ** (1/3))
            px = tx + r * math.sin(phi) * math.cos(theta)
            py = ty + r * math.sin(phi) * math.sin(theta)
            pz = canopy_base_z + (th * 0.65) * (1 + math.cos(phi)) / 2.0
            points_list.append([px, py, pz])
            var = int(np.random.uniform(-20, 20))
            colors_list.append([
                np.clip(35 + var, 0, 255),
                np.clip(130 + var, 0, 255),
                np.clip(40 + var, 0, 255),
            ])
            classifications_list.append(5)

    pts_arr = np.array(points_list, dtype=np.float64)
    cols_arr = np.array(colors_list, dtype=np.uint8)
    classes_arr = np.array(classifications_list, dtype=np.uint8)

    print(f"[+] Total synthetic points generated: {len(pts_arr):,}")

    # Save point cloud as LAS or fallback NPZ
    save_pointcloud(output_path, pts_arr, cols_arr, classes_arr)

    # Save georeference metadata
    meta = {
        "source": "synthetic_generator",
        "point_count": len(pts_arr),
        "bounds": {
            "min_x": float(np.min(pts_arr[:, 0])),
            "max_x": float(np.max(pts_arr[:, 0])),
            "min_y": float(np.min(pts_arr[:, 1])),
            "max_y": float(np.max(pts_arr[:, 1])),
            "min_z": float(np.min(pts_arr[:, 2])),
            "max_z": float(np.max(pts_arr[:, 2])),
        },
        "origin_offset": [0.0, 0.0, 0.0],
        "crs": "LOCAL_METRIC_COORDINATES",
    }

    meta_path = output_path.with_suffix(".json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[+] Georeference metadata written: {meta_path}")

    return meta


def save_pointcloud(
    output_path: Path,
    points: np.ndarray,
    colors: np.ndarray = None,
    classification: np.ndarray = None,
):
    """Saves point cloud to LAS/LAZ or falls back to standard PLY/XYZ."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if laspy is not None and str(output_path).endswith((".las", ".laz")):
        try:
            header = laspy.LasHeader(point_format=3, version="1.4")
            las = laspy.LasData(header)
            las.x = points[:, 0]
            las.y = points[:, 1]
            las.z = points[:, 2]

            if colors is not None:
                # LAS expects 16-bit RGB (0-65535)
                las.red = (colors[:, 0].astype(np.uint16) * 256)
                las.green = (colors[:, 1].astype(np.uint16) * 256)
                las.blue = (colors[:, 2].astype(np.uint16) * 256)

            if classification is not None:
                las.classification = classification

            las.write(str(output_path))
            print(f"[✓] Saved point cloud (LAS format): {output_path}")
            return
        except Exception as e:
            print(f"[!] Warning: laspy save failed: {e}. Falling back to PLY.")

    # Standalone ASCII/Binary PLY fallback (works with no dependencies)
    ply_path = output_path.with_suffix(".ply")
    with open(ply_path, "w") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        f.write("property float x\nproperty float y\nproperty float z\n")
        if colors is not None:
            f.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
        if classification is not None:
            f.write("property uchar classification\n")
        f.write("end_header\n")

        for i in range(len(points)):
            line = f"{points[i,0]:.4f} {points[i,1]:.4f} {points[i,2]:.4f}"
            if colors is not None:
                line += f" {int(colors[i,0])} {int(colors[i,1])} {int(colors[i,2])}"
            if classification is not None:
                line += f" {int(classification[i])}"
            f.write(line + "\n")

    print(f"[✓] Saved point cloud (PLY format): {ply_path}")


def ingest_local_las(input_path: Path, output_path: Path) -> dict:
    """Ingests local LAS/LAZ, normalizes coordinates to local origin (0, 0, 0)."""
    if not input_path.exists():
        raise FileNotFoundError(f"Input point cloud not found: {input_path}")

    print(f"[*] Ingesting point cloud from {input_path}...")

    if laspy is None:
        raise ImportError("laspy is required to ingest LAS/LAZ files. Install via: pip install 'laspy[lazrs]'")

    las = laspy.read(str(input_path))
    points = np.vstack((las.x, las.y, las.z)).transpose()

    # Calculate origin offset for single-precision stability
    origin_x = float(np.mean(points[:, 0]))
    origin_y = float(np.mean(points[:, 1]))
    origin_z = float(np.min(points[:, 2]))

    normalized_points = np.copy(points)
    normalized_points[:, 0] -= origin_x
    normalized_points[:, 1] -= origin_y
    normalized_points[:, 2] -= origin_z

    colors = None
    if hasattr(las, "red") and hasattr(las, "green") and hasattr(las, "blue"):
        r = (las.red / 256).astype(np.uint8)
        g = (las.green / 256).astype(np.uint8)
        b = (las.blue / 256).astype(np.uint8)
        colors = np.vstack((r, g, b)).transpose()

    classification = None
    if hasattr(las, "classification"):
        classification = np.array(las.classification, dtype=np.uint8)

    save_pointcloud(output_path, normalized_points, colors, classification)

    meta = {
        "source": str(input_path),
        "point_count": len(points),
        "bounds_original": {
            "min_x": float(np.min(points[:, 0])),
            "max_x": float(np.max(points[:, 0])),
            "min_y": float(np.min(points[:, 1])),
            "max_y": float(np.max(points[:, 1])),
            "min_z": float(np.min(points[:, 2])),
            "max_z": float(np.max(points[:, 2])),
        },
        "origin_offset": [origin_x, origin_y, origin_z],
        "normalized_bounds": {
            "min_x": float(np.min(normalized_points[:, 0])),
            "max_x": float(np.max(normalized_points[:, 0])),
            "min_y": float(np.min(normalized_points[:, 1])),
            "max_y": float(np.max(normalized_points[:, 1])),
            "min_z": float(np.min(normalized_points[:, 2])),
            "max_z": float(np.max(normalized_points[:, 2])),
        },
    }

    meta_path = output_path.with_suffix(".json")
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[✓] Point cloud ingested & centered. Stored to: {output_path}")
    return meta


def query_usgs_3dep(
    bbox: list,
    output_path: Path,
    grid_size: int = 50,
) -> dict:
    """
    Queries USGS 3DEP Elevation Point Query Service (EPQS) for a bounding box [min_lon, min_lat, max_lon, max_lat]
    and generates an elevation terrain point cloud.
    """
    if requests is None:
        raise ImportError("requests library is required for USGS 3DEP querying. Install via: pip install requests")

    min_lon, min_lat, max_lon, max_lat = bbox
    print(f"[*] Querying USGS 3DEP Elevation Endpoint for BBox: [{min_lon}, {min_lat}, {max_lon}, {max_lat}]...")

    lons = np.linspace(min_lon, max_lon, grid_size)
    lats = np.linspace(min_lat, max_lat, grid_size)

    # Approximate local metric conversion (WGS84 lat/lon to meters)
    lat_center = (min_lat + max_lat) / 2.0
    meters_per_deg_lat = 111132.954 - 559.822 * math.cos(2 * math.radians(lat_center))
    meters_per_deg_lon = 111412.84 * math.cos(math.radians(lat_center))

    points = []
    colors = []

    # Query USGS endpoint
    endpoint = "https://epqs.nationalmap.gov/v1/json"
    sampled_count = 0

    print(f"[*] Sampling {grid_size}x{grid_size} elevation grid via USGS EPQS API...")
    for i, lon in enumerate(lons):
        for j, lat in enumerate(lats):
            try:
                resp = requests.get(endpoint, params={"x": lon, "y": lat, "units": "Meters", "wkid": 4326}, timeout=5)
                if resp.status_code == 200:
                    data = resp.json()
                    elev_val = float(data.get("value", -1000000))
                    if elev_val > -9999:
                        # Local metric offset
                        x_m = (lon - (min_lon + max_lon) / 2.0) * meters_per_deg_lon
                        y_m = (lat - (min_lat + max_lat) / 2.0) * meters_per_deg_lat
                        points.append([x_m, y_m, elev_val])
                        colors.append([70, 120, 60])
                        sampled_count += 1
            except Exception:
                continue

    if len(points) == 0:
        raise RuntimeError("Elevation acquisition returned no usable points. No model was created. Check the data source or use --demo explicitly for fictional data.")

    pts_arr = np.array(points, dtype=np.float64)
    cols_arr = np.array(colors, dtype=np.uint8)

    # Normalize Z to base 0
    min_z = float(np.min(pts_arr[:, 2]))
    pts_arr[:, 2] -= min_z

    save_pointcloud(output_path, pts_arr, cols_arr)

    meta = {
        "source": "USGS_3DEP_EPQS",
        "geometry_role": "terrain-only",
        "source_axes": "east-north-up",
        "units": "meters",
        "bbox_wgs84": bbox,
        "point_count": len(pts_arr),
        "origin_offset": [(min_lon + max_lon) / 2.0, (min_lat + max_lat) / 2.0, min_z],
        "bounds_metric": {
            "min_x": float(np.min(pts_arr[:, 0])),
            "max_x": float(np.max(pts_arr[:, 0])),
            "min_y": float(np.min(pts_arr[:, 1])),
            "max_y": float(np.max(pts_arr[:, 1])),
            "min_z": float(np.min(pts_arr[:, 2])),
            "max_z": float(np.max(pts_arr[:, 2])),
        },
    }

    with open(output_path.with_suffix(".json"), "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[✓] Successfully retrieved {len(pts_arr)} USGS elevation points.")
    return meta


def main():
    parser = argparse.ArgumentParser(description="Fetch and ingest elevation and LiDAR point cloud data.")
    parser.add_argument("--bbox", type=str, help="Bounding box as min_lon,min_lat,max_lon,max_lat (WGS84)")
    parser.add_argument("--input-las", type=str, help="Path to local LAS/LAZ point cloud")
    parser.add_argument("--output", type=str, default="data/raw/elevation_input.las", help="Output path for ingested point cloud")
    parser.add_argument("--generate-demo", action="store_true", help="Generate synthetic residential property point cloud")
    parser.add_argument("--query-usgs", action="store_true", help="Query live USGS 3DEP elevation API")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    create_directory_structure(project_root)

    out_path = Path(args.output)
    if not out_path.is_absolute():
        out_path = project_root / out_path

    if args.input_las:
        in_path = Path(args.input_las)
        if not in_path.is_absolute():
            in_path = project_root / in_path
        ingest_local_las(in_path, out_path)
    elif args.query_usgs and args.bbox:
        bbox = [float(x.strip()) for x in args.bbox.split(",")]
        query_usgs_3dep(bbox, out_path)
    elif args.generate_demo or True:
        # Default to synthetic generation if no inputs specified
        generate_synthetic_residential_cloud(out_path)


if __name__ == "__main__":
    main()
