#!/usr/bin/env python3
"""Audit and export public source without private folders or Git history."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import zipfile
from asset_report import scan_deployable_tree
from generate_demo import generate_demo

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = {'.gitignore', '.vercelignore', 'LICENSE.md', 'README.md', 'index.html', 'requirements.txt', 'vercel.json'}
PUBLIC_DIRS = {'configure', 'docs', 'properties', 'schemas', 'scripts', 'src', 'tests'}
SUFFIXES = {'.md', '.html', '.css', '.js', '.mjs', '.py', '.json', '.glb'}


def public_files(root: Path):
    files = []
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        parts = relative.parts
        if path.is_symlink() and (parts[0] in PUBLIC_DIRS or relative.as_posix() == 'viewer/index.html' or path.name in ROOT_FILES):
            raise ValueError(f'Public source must not include a symlink: {relative}')
        if any(part.startswith('.') or part == '__pycache__' for part in parts):
            if len(parts) == 1 and path.name in ROOT_FILES:
                files.append(path)
            continue
        if not path.is_file():
            continue
        if (len(parts) == 1 and path.name in ROOT_FILES) or parts[0] in PUBLIC_DIRS or relative.as_posix() == 'viewer/index.html':
            if path.is_symlink():
                raise ValueError(f'Public source must not include a symlink: {relative}')
            if len(parts) > 1 and path.suffix not in SUFFIXES:
                raise ValueError(f'Unexpected public source file: {relative}')
            if path.suffix == '.glb' and relative.as_posix() != 'properties/demo/model.glb':
                raise ValueError(f'Only the fictional demo GLB may be exported: {relative}')
            if parts[0] == 'properties' and relative.as_posix() not in {'properties/index.json', 'properties/README.md', 'properties/demo/model.glb', 'properties/demo/property.json', 'properties/example/README.md', 'properties/example/property.json'}:
                raise ValueError(f'Unreviewed property source: {relative}')
            files.append(path)
    return files


def audit_source(root: Path, files, private_policy: Path | None = None):
    if private_policy is not None and not private_policy.is_file():
        raise ValueError('The requested private marker policy is missing; refusing to skip it.')
    policy_path = private_policy or root/'data/private/sensitive-markers.json'
    policy = json.loads(policy_path.read_text()) if policy_path.exists() else {}
    markers = [str(value).casefold() for value in policy.get('textMarkers', []) if value]
    models = set(policy.get('privateModelSha256', []))
    findings = []
    for path in files:
        data = path.read_bytes()
        relative = path.relative_to(root).as_posix()
        if hashlib.sha256(data).hexdigest() in models:
            findings.append(f'Private model matches public file: {relative}')
        if path.suffix != '.glb':
            content = data.decode('utf-8').casefold()
            if any(marker in content for marker in markers):
                findings.append(f'Known personal marker in public file: {relative}')
    deployed = scan_deployable_tree(root)
    findings.extend(f"Public asset audit: {item['code']} in {item.get('path', 'source')}" for item in deployed['findings'] if item['severity'] == 'blocker')
    config = json.loads((root/'properties/demo/property.json').read_text())
    if config.get('package', {}).get('revision') != 'fictional-1' or 'Invented primitive' not in config.get('package', {}).get('description', ''):
        findings.append('The default sample must declare fictional provenance.')
    with tempfile.TemporaryDirectory() as folder:
        reference = generate_demo(Path(folder)).read_bytes()
        if (root/'properties/demo/model.glb').read_bytes() != reference:
            findings.append('Demo bytes do not match the invented primitive generator.')
    return findings


def export_source(root: Path, destination: Path, private_policy: Path | None = None):
    root = root.resolve()
    files = public_files(root)
    findings = audit_source(root, files, private_policy)
    if findings:
        raise ValueError('\n'.join(findings))
    destination.parent.mkdir(parents=True, exist_ok=True)
    inventory = []
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            data = path.read_bytes()
            name = path.relative_to(root).as_posix()
            archive.writestr('home-solar-tracker/'+name, data)
            inventory.append({'path':name, 'bytes':len(data), 'sha256':hashlib.sha256(data).hexdigest()})
    report = {'status':'passed', 'scope':'current source snapshot only; no Git history', 'files':inventory, 'fictionalDemoReproduced':True, 'privateMarkerPolicyApplied':bool((private_policy or root/'data/private/sensitive-markers.json').exists())}
    destination.with_suffix('.inventory.json').write_text(json.dumps(report,indent=2)+'\n')
    return len(files)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT)
    parser.add_argument('--output',type=Path,default=ROOT/'output/public-source/home-solar-tracker-source.zip')
    parser.add_argument('--private-markers',type=Path)
    args=parser.parse_args()
    try:
        count=export_source(args.root,args.output,args.private_markers)
        print(f'Public source audit passed: {count} files.\nClean source ZIP: {args.output}\nNo Git history, private folders, or non-demo models included. Never include pre-cleanup Git history in the public repository.')
    except (ValueError, OSError, json.JSONDecodeError) as error:
        print(f'Public source export blocked: {error}',file=sys.stderr);sys.exit(1)
