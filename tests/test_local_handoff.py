from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from serve import allowed_request

try:
    import numpy as np
    import trimesh
    import process_pointcloud
    import fetch_elevation
    import pipeline
except ImportError:
    np = None


class LocalServingTests(unittest.TestCase):
    def test_only_viewer_assets_are_served_and_private_sources_are_hidden(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for path in ['/', '/index.html', '/configure/index.html', '/src/solar.js', '/local-properties/garden/revisions/1/property.json']:
                self.assertTrue(allowed_request(root, path), path)
            for path in ['/.env', '/.git/config', '/data/raw/house.las', '/output/house.glb', '/scripts/serve.py', '/src/private.las', '/src/%2e%2e/.env', '/src/%252e%252e/.env', '/src/..%5c.env']:
                self.assertFalse(allowed_request(root, path), path)
            (root / 'src').symlink_to(Path(folder).parent, target_is_directory=True)
            self.assertFalse(allowed_request(root, '/src/secrets.json'))


@unittest.skipIf(np is None, 'Scientific dependencies require the project .venv')
class PipelineSafetyTests(unittest.TestCase):
    def test_asymmetric_model_glb_uses_viewer_axes_and_preserves_obj_source_axes(self):
        mesh = trimesh.creation.box(extents=[2, 4, 8])
        mesh.apply_translation([3, 5, 4])
        with tempfile.TemporaryDirectory() as folder:
            files = process_pointcloud.optimize_and_export_mesh(mesh.vertices, mesh.faces, output_dir=Path(folder), export_formats=['obj', 'glb'])
            glb = trimesh.load(files['glb'], force='mesh')
            obj = trimesh.load(files['obj'], force='mesh')
            np.testing.assert_allclose(glb.bounds, [[-4, 0, -7], [-2, 8, -3]])
            np.testing.assert_allclose(obj.bounds, [[2, 3, 0], [4, 7, 8]])
            self.assertTrue(glb.is_winding_consistent)
            self.assertGreater(glb.volume, 0)
            files = process_pointcloud.optimize_and_export_mesh(glb.vertices, glb.faces, output_dir=Path(folder), base_name='already-viewer', export_formats=['glb'], source_axes='viewer')
            np.testing.assert_allclose(trimesh.load(files['glb'], force='mesh').bounds, glb.bounds)

    def test_failed_elevation_never_generates_fictional_house(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(fetch_elevation.requests, 'get', side_effect=OSError('offline')), patch.object(fetch_elevation, 'generate_synthetic_residential_cloud') as synthetic:
            destination = Path(folder) / 'survey.las'
            with self.assertRaisesRegex(RuntimeError, 'No model was created'):
                fetch_elevation.query_usgs_3dep([-79, 39, -78.99, 39.01], destination, grid_size=2)
            synthetic.assert_not_called()
            self.assertFalse(destination.exists())

    def test_real_property_rejects_terrain_only_or_fictional_input_before_writes(self):
        with patch.object(fetch_elevation, 'create_directory_structure') as create:
            for args in [{'bbox':'-79,39,-78.99,39.01'}, {'is_demo':True}]:
                with self.assertRaises(ValueError):
                    pipeline.run_pipeline(property_slug='real-house', **args)
            create.assert_not_called()


if __name__ == '__main__':
    unittest.main()
