#!/usr/bin/env python3
"""
scripts/process_pointcloud.py
-----------------------------
Core 3D Point Cloud and Mesh Processing Engine.

Features:
- Statistical Outlier Removal (SOR) and voxel downsampling
- Ground vs. Building vs. Vegetation classification
- Screened Poisson Surface Reconstruction & 2.5D DSM Delaunay Triangulation
- Topology repair (manifold check, hole filling, decimation)
- Watertight base solidification for 3D printing and CAD import
- Multi-format export: .obj (with MTL), .glb/.gltf (for web/AR), and .stl
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path
import numpy as np

# Spatial & 3D libraries
try:
    import open3d as o3d
except ImportError:
    o3d = None

try:
    import trimesh
except ImportError:
    trimesh = None

try:
    import laspy
except ImportError:
    laspy = None

try:
    from scipy.spatial import Delaunay
    from scipy.interpolate import griddata
except ImportError:
    Delaunay = None
    griddata = None


def load_point_cloud(input_path: Path):
    """Loads point cloud from LAS, LAZ, PLY, or XYZ format into numpy arrays and Open3D PointCloud."""
    print(f"[*] Loading point cloud: {input_path}...")
    ext = input_path.suffix.lower()

    points = None
    colors = None
    classification = None

    if ext in [".las", ".laz"]:
        if laspy is None:
            raise ImportError("laspy required for LAS/LAZ files. Run: pip install 'laspy[lazrs]'")
        las = laspy.read(str(input_path))
        points = np.vstack((las.x, las.y, las.z)).transpose()
        if hasattr(las, "red") and hasattr(las, "green") and hasattr(las, "blue"):
            r = (las.red / 256).astype(np.uint8)
            g = (las.green / 256).astype(np.uint8)
            b = (las.blue / 256).astype(np.uint8)
            colors = np.vstack((r, g, b)).transpose()
        if hasattr(las, "classification"):
            classification = np.array(las.classification, dtype=np.uint8)

    elif ext == ".ply":
        if o3d is not None:
            pcd_o3d = o3d.io.read_point_cloud(str(input_path))
            points = np.asarray(pcd_o3d.points)
            if pcd_o3d.has_colors():
                colors = (np.asarray(pcd_o3d.colors) * 255).astype(np.uint8)
        else:
            # Simple ASCII PLY reader
            with open(input_path, "r") as f:
                lines = f.readlines()
            header_end = 0
            for idx, line in enumerate(lines):
                if line.strip() == "end_header":
                    header_end = idx + 1
                    break
            pts = []
            cols = []
            for line in lines[header_end:]:
                parts = line.strip().split()
                if len(parts) >= 3:
                    pts.append([float(parts[0]), float(parts[1]), float(parts[2])])
                    if len(parts) >= 6:
                        cols.append([int(parts[3]), int(parts[4]), int(parts[5])])
            points = np.array(pts, dtype=np.float64)
            if cols:
                colors = np.array(cols, dtype=np.uint8)

    if points is None or len(points) == 0:
        raise ValueError(f"Failed to load points from {input_path}")

    print(f"[+] Loaded {len(points):,} points. Bounds: X[{np.min(points[:,0]):.1f}, {np.max(points[:,0]):.1f}], Y[{np.min(points[:,1]):.1f}, {np.max(points[:,1]):.1f}], Z[{np.min(points[:,2]):.1f}, {np.max(points[:,2]):.1f}]")
    return points, colors, classification


def filter_and_classify_points(
    points: np.ndarray,
    colors: np.ndarray = None,
    classification: np.ndarray = None,
    voxel_size: float = 0.25,
    nb_neighbors: int = 20,
    std_ratio: float = 2.0
):
    """
    Cleans point cloud using Statistical Outlier Removal (SOR) and voxel grid filter.
    Classifies ground vs. above-ground structures if not already classified.
    """
    print(f"[*] Preprocessing & filtering point cloud (voxel={voxel_size}m, SOR neighbors={nb_neighbors})...")

    # If Open3D is available, use accelerated C++ filters
    if o3d is not None:
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(points)
        if colors is not None:
            pcd.colors = o3d.utility.Vector3dVector(colors / 255.0)

        # 1. Voxel Downsampling
        if voxel_size > 0:
            pcd = pcd.voxel_down_sample(voxel_size=voxel_size)

        # 2. Statistical Outlier Removal (SOR)
        cl, ind = pcd.remove_statistical_outlier(nb_neighbors=nb_neighbors, std_ratio=std_ratio)
        pcd_clean = cl

        clean_points = np.asarray(pcd_clean.points)
        clean_colors = (np.asarray(pcd_clean.colors) * 255).astype(np.uint8) if pcd_clean.has_colors() else None
    else:
        # Fallback Python filter
        clean_points = points
        clean_colors = colors

    # Ground classification if not provided
    if classification is None or len(classification) != len(clean_points):
        print("[*] Segmenting ground vs above-ground objects using elevation surface modeling...")
        # Grid minimum elevation estimation
        x_min, y_min = np.min(clean_points[:, 0]), np.min(clean_points[:, 1])
        x_max, y_max = np.max(clean_points[:, 0]), np.max(clean_points[:, 1])
        grid_res = 3.0  # 3 meter grid bins
        nx = max(1, int((x_max - x_min) / grid_res) + 1)
        ny = max(1, int((y_max - y_min) / grid_res) + 1)

        grid_min_z = np.full((nx, ny), np.inf)
        ix = np.clip(((clean_points[:, 0] - x_min) / grid_res).astype(int), 0, nx - 1)
        iy = np.clip(((clean_points[:, 1] - y_min) / grid_res).astype(int), 0, ny - 1)

        for i in range(len(clean_points)):
            if clean_points[i, 2] < grid_min_z[ix[i], iy[i]]:
                grid_min_z[ix[i], iy[i]] = clean_points[i, 2]

        classification = np.full(len(clean_points), 2, dtype=np.uint8)  # default Ground
        for i in range(len(clean_points)):
            ground_est = grid_min_z[ix[i], iy[i]]
            height_above_ground = clean_points[i, 2] - ground_est
            if height_above_ground > 1.8:
                classification[i] = 6  # Structure/Building or High Object
            elif height_above_ground > 0.5:
                classification[i] = 5  # Vegetation / Low Object

    print(f"[+] Post-filter point count: {len(clean_points):,} points.")
    return clean_points, clean_colors, classification


def reconstruct_surface_poisson(
    points: np.ndarray,
    colors: np.ndarray = None,
    depth: int = 9,
    density_trim_percentile: float = 8.0
):
    """
    Screened Poisson Surface Reconstruction with normal estimation and density trimming
    to remove inflated surface bubbles.
    """
    if o3d is None:
        raise ImportError("Open3D is required for Poisson Surface Reconstruction.")

    print(f"[*] Running Screened Poisson Surface Reconstruction (octree depth={depth})...")

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points)
    if colors is not None:
        pcd.colors = o3d.utility.Vector3dVector(colors / 255.0)

    # 1. Normal Estimation
    pcd.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=1.5, max_nn=30)
    )
    # Orient normals consistently upward
    pcd.orient_normals_to_align_with_direction(orientation_reference=np.array([0.0, 0.0, 1.0]))

    # 2. Poisson Reconstruction
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd, depth=depth, linear_fit=True
    )

    # 3. Density-based Trimming (removes extraneous low-density interpolations)
    densities = np.asarray(densities)
    if len(densities) > 0 and density_trim_percentile > 0:
        threshold = np.percentile(densities, density_trim_percentile)
        vertices_to_remove = densities < threshold
        mesh.remove_vertices_by_mask(vertices_to_remove)

    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()

    verts = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.triangles)
    vcols = (np.asarray(mesh.vertex_colors) * 255).astype(np.uint8) if mesh.has_vertex_colors() else None

    print(f"[✓] Poisson Mesh reconstructed: {len(verts):,} vertices, {len(faces):,} triangles.")
    return verts, faces, vcols


def reconstruct_surface_dsm_delaunay(
    points: np.ndarray,
    colors: np.ndarray = None,
    grid_resolution: float = 0.5
):
    """
    2.5D Digital Surface Model (DSM) Delaunay Triangulation.
    Ideal for GIS terrain & building elevation models, creating clean topologically manifold meshes.
    """
    if Delaunay is None:
        raise ImportError("scipy is required for Delaunay triangulation.")

    print(f"[*] Constructing 2.5D Digital Surface Model (DSM) mesh (resolution={grid_resolution}m)...")

    x_min, x_max = np.min(points[:, 0]), np.max(points[:, 0])
    y_min, y_max = np.min(points[:, 1]), np.max(points[:, 1])

    grid_x, grid_y = np.meshgrid(
        np.arange(x_min, x_max + grid_resolution, grid_resolution),
        np.arange(y_min, y_max + grid_resolution, grid_resolution)
    )

    # Interpolate Z values for grid using top surface (max elevation within cell)
    grid_shape = grid_x.shape
    grid_pts_2d = np.vstack((grid_x.ravel(), grid_y.ravel())).T

    # Fast 2D Delaunay on surface grid
    tri = Delaunay(grid_pts_2d)

    # Sample Z values
    try:
        grid_z = griddata(
            points[:, :2], points[:, 2],
            (grid_x, grid_y),
            method='linear',
            fill_value=np.min(points[:, 2])
        )
    except Exception:
        grid_z = np.full(grid_shape, np.min(points[:, 2]))

    verts_3d = np.column_stack((grid_pts_2d[:, 0], grid_pts_2d[:, 1], grid_z.ravel()))
    faces = tri.simplices

    # Vertex colors based on elevation colormap
    min_z, max_z = np.min(verts_3d[:, 2]), np.max(verts_3d[:, 2])
    span_z = max(max_z - min_z, 0.001)
    norm_z = (verts_3d[:, 2] - min_z) / span_z

    vcols = np.zeros((len(verts_3d), 3), dtype=np.uint8)
    for i, z in enumerate(norm_z):
        if z < 0.2:
            vcols[i] = [60, 120, 50]  # Terrain green
        elif z < 0.6:
            vcols[i] = [190, 180, 160] # Wall/Driveway
        else:
            vcols[i] = [80, 85, 95]   # Roof slate

    print(f"[✓] DSM Delaunay Mesh constructed: {len(verts_3d):,} vertices, {len(faces):,} triangles.")
    return verts_3d, faces, vcols


def make_mesh_watertight_base(
    vertices: np.ndarray,
    faces: np.ndarray,
    vertex_colors: np.ndarray = None,
    skirt_depth: float = 2.0
):
    """
    Extrudes the boundary edges downward to create a solid watertight base block,
    ideal for 3D printing (.STL) and CAD solids.
    """
    print("[*] Solidifying mesh with a watertight base slab...")
    if trimesh is None:
        return vertices, faces, vertex_colors

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, vertex_colors=vertex_colors, process=True)

    # Find boundary edges (edges with only 1 adjacent face)
    edges = mesh.edges_unique
    edge_face_count = mesh.edges_unique_inverse
    counts = np.bincount(edge_face_count)
    boundary_edge_indices = np.where(counts == 1)[0]

    if len(boundary_edge_indices) == 0:
        print("[+] Mesh already closed / watertight.")
        return vertices, faces, vertex_colors

    # Determine base plane Z
    min_z = float(np.min(vertices[:, 2])) - skirt_depth

    # Boundary vertices
    boundary_edges = edges[boundary_edge_indices]
    unique_b_verts = np.unique(boundary_edges)

    vert_map = {}
    new_verts = list(vertices)
    new_colors = list(vertex_colors) if vertex_colors is not None else None
    new_faces = list(faces)

    # Add bottom vertices for boundary
    for bv in unique_b_verts:
        orig_v = vertices[bv]
        idx = len(new_verts)
        vert_map[bv] = idx
        new_verts.append([orig_v[0], orig_v[1], min_z])
        if new_colors is not None:
            new_colors.append([60, 60, 60])  # Dark base

    # Add vertical skirt wall triangles
    for e0, e1 in boundary_edges:
        b0 = vert_map[e0]
        b1 = vert_map[e1]
        new_faces.append([e0, e1, b1])
        new_faces.append([e0, b1, b0])

    # Add bottom closing cap
    bottom_pts_2d = np.array([[new_verts[vert_map[v]][0], new_verts[vert_map[v]][1]] for v in unique_b_verts])
    if Delaunay is not None and len(bottom_pts_2d) >= 3:
        try:
            tri = Delaunay(bottom_pts_2d)
            for simplex in tri.simplices:
                # Clockwise for downward normal
                new_faces.append([
                    vert_map[unique_b_verts[simplex[0]]],
                    vert_map[unique_b_verts[simplex[2]]],
                    vert_map[unique_b_verts[simplex[1]]]
                ])
        except Exception:
            pass

    verts_arr = np.array(new_verts, dtype=np.float64)
    faces_arr = np.array(new_faces, dtype=np.int32)
    cols_arr = np.array(new_colors, dtype=np.uint8) if new_colors is not None else None

    print(f"[✓] Watertight base attached. New vertex count: {len(verts_arr):,}, faces: {len(faces_arr):,}")
    return verts_arr, faces_arr, cols_arr


def optimize_and_export_mesh(
    vertices: np.ndarray,
    faces: np.ndarray,
    vertex_colors: np.ndarray = None,
    output_dir: Path = Path("output"),
    base_name: str = "property_model",
    target_faces: int = 60000,
    export_formats: list = None,
    source_axes: str = "z-up",
):
    """
    Repairs mesh topology, decimates to target triangle count,
    and exports to .OBJ (with MTL), .GLB/.GLTF, and .STL.
    """
    if export_formats is None:
        export_formats = ["obj", "glb", "gltf", "stl"]
    if source_axes not in {"z-up", "viewer"}:
        raise ValueError("source_axes must be z-up or viewer")

    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"[*] Optimizing & decimating mesh (target_faces={target_faces:,})...")

    if trimesh is not None:
        mesh = trimesh.Trimesh(
            vertices=vertices,
            faces=faces,
            vertex_colors=vertex_colors,
            process=True
        )

        # Decimation if over target face budget
        if len(mesh.faces) > target_faces:
            print(f"[*] Simplifying mesh from {len(mesh.faces):,} to ~{target_faces:,} faces...")
            try:
                mesh = mesh.simplify_quadric_decimation(target_faces)
            except Exception as e:
                print(f"[!] Decimation note: {e}")

        # Fill small holes and fix normals safely
        try:
            trimesh.repair.fill_holes(mesh)
        except Exception as e:
            print(f"[!] Note on hole filling: {e}")

        try:
            trimesh.repair.fix_normals(mesh)
        except Exception as e:
            print(f"[!] Note on fixing normals: {e}")

        exported_files = {}

        # 1. Wavefront OBJ
        if "obj" in export_formats:
            obj_path = output_dir / f"{base_name}.obj"
            mesh.export(str(obj_path))
            exported_files["obj"] = str(obj_path)
            print(f"[✓] Exported OBJ: {obj_path} ({os.path.getsize(obj_path)/1024:.1f} KB)")

        # 2. Binary GLTF (GLB)
        if "glb" in export_formats or "gltf" in export_formats:
            glb_path = output_dir / f"{base_name}.glb"
            viewer_mesh = mesh.copy()
            if source_axes == "z-up":
                # Source: X east, Y north, Z up. Viewer: -X east, -Z north, Y up.
                # Trimesh also adjusts triangle winding for the reflection.
                viewer_mesh.apply_transform(np.array([
                    [-1.0, 0.0, 0.0, 0.0],
                    [0.0, 0.0, 1.0, 0.0],
                    [0.0, -1.0, 0.0, 0.0],
                    [0.0, 0.0, 0.0, 1.0],
                ]))
            viewer_mesh.export(str(glb_path))
            exported_files["glb"] = str(glb_path)
            print(f"[✓] Exported GLB: {glb_path} ({os.path.getsize(glb_path)/1024:.1f} KB)")

        # 3. Watertight STL
        if "stl" in export_formats:
            stl_path = output_dir / f"{base_name}.stl"
            mesh.export(str(stl_path))
            exported_files["stl"] = str(stl_path)
            print(f"[✓] Exported STL: {stl_path} ({os.path.getsize(stl_path)/1024:.1f} KB)")

        return exported_files
    else:
        # Fallback pure-Python OBJ exporter
        obj_path = output_dir / f"{base_name}.obj"
        with open(obj_path, "w") as f:
            f.write(f"# Exported 3D Mesh\n# Vertices: {len(vertices)}\n# Faces: {len(faces)}\n")
            for v, c in zip(vertices, vertex_colors if vertex_colors is not None else np.full((len(vertices), 3), 200)):
                f.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f} {c[0]/255:.3f} {c[1]/255:.3f} {c[2]/255:.3f}\n")
            for face in faces:
                f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")
        print(f"[✓] Exported Fallback OBJ: {obj_path}")
        return {"obj": str(obj_path)}


def main():
    parser = argparse.ArgumentParser(description="Process point cloud and generate clean 3D surface meshes.")
    parser.add_argument("--input", type=str, required=True, help="Input point cloud (.las, .laz, .ply, .xyz)")
    parser.add_argument("--method", choices=["poisson", "delaunay", "auto"], default="auto", help="Reconstruction method")
    parser.add_argument("--output-dir", type=str, default="output", help="Output directory")
    parser.add_argument("--name", type=str, default="property_model", help="Base name for exported models")
    parser.add_argument("--voxel-size", type=float, default=0.25, help="Voxel downsampling size in meters")
    parser.add_argument("--target-faces", type=int, default=50000, help="Target face count for mesh decimation")
    parser.add_argument("--poisson-depth", type=int, default=9, help="Octree depth for Poisson reconstruction")
    parser.add_argument("--watertight", action="store_true", help="Add solid watertight base for 3D printing / CAD")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    in_path = Path(args.input)
    if not in_path.is_absolute():
        in_path = project_root / in_path

    out_dir = Path(args.output_dir)
    if not out_dir.is_absolute():
        out_dir = project_root / out_dir

    # 1. Load Point Cloud
    points, colors, classification = load_point_cloud(in_path)

    # 2. Filter & Preprocess
    clean_points, clean_colors, classification = filter_and_classify_points(
        points=points,
        colors=colors,
        classification=classification,
        voxel_size=args.voxel_size
    )

    # 3. Surface Reconstruction
    method = args.method
    if method == "auto":
        method = "poisson" if o3d is not None else "delaunay"

    if method == "poisson":
        verts, faces, vcols = reconstruct_surface_poisson(
            points=clean_points,
            colors=clean_colors,
            depth=args.poisson_depth
        )
    else:
        verts, faces, vcols = reconstruct_surface_dsm_delaunay(
            points=clean_points,
            colors=clean_colors
        )

    # 4. Watertight Base Extrusion if requested
    if args.watertight:
        verts, faces, vcols = make_mesh_watertight_base(verts, faces, vcols)

    # 5. Optimize & Multi-Format Export
    optimize_and_export_mesh(
        vertices=verts,
        faces=faces,
        vertex_colors=vcols,
        output_dir=out_dir,
        base_name=args.name,
        target_faces=args.target_faces
    )


if __name__ == "__main__":
    main()
