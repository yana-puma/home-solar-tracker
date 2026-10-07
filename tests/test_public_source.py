from pathlib import Path
import hashlib
import json
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from export_public_source import public_files, audit_source
from generate_demo import generate_demo


class PublicSourceTests(unittest.TestCase):
    def test_fictional_demo_is_reproducible_and_no_private_folder_is_exported(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            first=generate_demo(root).read_bytes()
            second=generate_demo(root).read_bytes()
            self.assertEqual(first,second)
            for name in ['.git/config','data/private/house.json','output/house.glb','local-properties/house/model.glb','.env']:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('private')
            selected=[p.relative_to(root).as_posix() for p in public_files(root)]
            self.assertEqual(set(selected),{'properties/demo/model.glb','properties/demo/property.json','properties/index.json'})
            config=json.loads((root/'properties/demo/property.json').read_text())
            self.assertEqual(config['package']['revision'],'fictional-1')
            self.assertEqual(config['assets'][0]['size'],len(first))
            self.assertEqual(config['location']['latitude'],40)

    def test_private_markers_and_old_model_bytes_block_public_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);model=generate_demo(root)
            source=root/'README.md';source.write_text('Sensitive test marker')
            policy=root/'data/private/sensitive-markers.json';policy.parent.mkdir(parents=True)
            policy.write_text(json.dumps({'textMarkers':['Sensitive test marker'],'privateModelSha256':[hashlib.sha256(model.read_bytes()).hexdigest()]}))
            findings=audit_source(root,public_files(root))
            self.assertTrue(any('Known personal marker' in item for item in findings))
            self.assertTrue(any('Private model matches' in item for item in findings))

    def test_explicit_missing_marker_policy_cannot_silently_skip_privacy_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);generate_demo(root)
            with self.assertRaisesRegex(ValueError,'policy is missing'):
                audit_source(root,public_files(root),root/'missing-policy.json')

    def test_extra_house_asset_and_public_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);generate_demo(root)
            extra=root/'properties/private-house.glb';extra.write_bytes(b'private')
            with self.assertRaisesRegex(ValueError,'Only the fictional demo'):
                public_files(root)
            extra.unlink()
            (root/'src').symlink_to(root/'properties',target_is_directory=True)
            with self.assertRaisesRegex(ValueError,'symlink'):
                public_files(root)


if __name__=='__main__':unittest.main()
