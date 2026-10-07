#!/usr/bin/env python3
"""
scripts/visualize.py
--------------------
Interactive 3D Visualizer for spatial property models and point clouds.

Features:
- Robust HTTP Three.js Web Viewer with drag-and-drop, bounding box tools, and shader toggles
- Desktop Open3D GUI viewer fallback
"""

import argparse
import http.server
import os
import sys
import webbrowser
from http.server import ThreadingHTTPServer
from pathlib import Path

try:
    import open3d as o3d
except ImportError:
    o3d = None


def launch_open3d_viewer(model_path: Path):
    """Launches native Open3D visualization window."""
    if o3d is None:
        print("[!] Open3D is not installed. Falling back to web viewer.")
        return False

    ext = model_path.suffix.lower()
    print(f"[*] Opening native Open3D visualizer for: {model_path}...")

    try:
        if ext in [".obj", ".ply", ".stl", ".gltf", ".glb"]:
            mesh = o3d.io.read_triangle_mesh(str(model_path))
            if not mesh.has_vertex_normals():
                mesh.compute_vertex_normals()
            if not mesh.has_vertex_colors():
                mesh.paint_uniform_color([0.7, 0.75, 0.8])

            coord = o3d.geometry.TriangleMesh.create_coordinate_frame(size=10.0, origin=[0, 0, 0])
            o3d.visualization.draw_geometries(
                [mesh, coord],
                window_name=f"3D Property Viewer - {model_path.name}",
                width=1280,
                height=800,
                left=50,
                top=50,
                mesh_show_wireframe=False,
                mesh_show_back_face=True
            )
            return True
        elif ext in [".las", ".laz", ".pcd", ".xyz"]:
            pcd = o3d.io.read_point_cloud(str(model_path))
            o3d.visualization.draw_geometries(
                [pcd],
                window_name=f"3D Point Cloud - {model_path.name}",
                width=1280,
                height=800
            )
            return True
    except Exception as e:
        print(f"[!] Open3D desktop visualization encountered an issue: {e}. Falling back to web viewer.")
        return False


class CustomHTTPHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP handler with CORS support and quiet logging."""
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, format, *args):
        if len(args) > 1 and str(args[1]) not in ['200', '304']:
            sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))


class ReusableThreadingServer(ThreadingHTTPServer):
    allow_reuse_address = True


def launch_web_viewer(project_root: Path, model_path: Path = None, port: int = 8080):
    """Launches local web server for the interactive Three.js viewer."""
    os.chdir(str(project_root))

    # Find available port
    chosen_port = port
    httpd = None
    for p in range(port, port + 30):
        try:
            httpd = ReusableThreadingServer(("", p), CustomHTTPHandler)
            chosen_port = p
            break
        except OSError:
            continue

    if httpd is None:
        print(f"[!] Could not bind to any port in range {port}-{port+30}")
        return

    relative_model_param = ""
    if model_path and model_path.exists():
        try:
            rel = model_path.relative_to(project_root)
            relative_model_param = f"?model=/{rel}"
        except ValueError:
            relative_model_param = f"?model=/{model_path.name}"

    viewer_url = f"http://localhost:{chosen_port}/viewer/index.html{relative_model_param}"
    print("\n" + "=" * 60)
    print("🚀  Interactive 3D Property Web Viewer Running at:")
    print(f"    👉  {viewer_url}")
    print("=" * 60)
    print("[*] Serving 3D models... Press Ctrl+C to stop.\n", flush=True)

    # Attempt to open browser non-blockingly
    try:
        webbrowser.open(viewer_url)
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[*] Stopping web server...")
    finally:
        httpd.server_close()


def main():
    parser = argparse.ArgumentParser(description="Visualize 3D Property models and LiDAR point clouds.")
    parser.add_argument("--input", type=str, default="output/property_model.glb", help="Path to 3D model or point cloud")
    parser.add_argument("--mode", choices=["web", "desktop", "auto"], default="web", help="Viewer mode (web or desktop Open3D)")
    parser.add_argument("--port", type=int, default=8080, help="Web server port")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent.parent

    target_path = Path(args.input)
    if not target_path.is_absolute():
        target_path = project_root / target_path

    if not target_path.exists():
        for alt_ext in [".glb", ".obj", ".stl", ".ply"]:
            candidate = target_path.with_suffix(alt_ext)
            if candidate.exists():
                target_path = candidate
                break

    if args.mode == "desktop":
        success = launch_open3d_viewer(target_path)
        if not success:
            launch_web_viewer(project_root, target_path, port=args.port)
    else:
        launch_web_viewer(project_root, target_path, port=args.port)


if __name__ == "__main__":
    main()
