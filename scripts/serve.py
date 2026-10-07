#!/usr/bin/env python3
"""Serve only viewer assets on loopback; no scientific dependencies required."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ALLOWED_DIRECTORIES = {"src", "configure", "properties", "schemas", "local-properties", "viewer"}
ALLOWED_SUFFIXES = {".html", ".js", ".css", ".json", ".glb", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"}


def allowed_request(root: Path, request: str) -> bool:
    path = unquote(urlsplit(request).path)
    parts = [part for part in path.split("/") if part]
    if any(part.startswith(".") or "\\" in part or "%" in part for part in parts):
        return False
    if parts and parts[0] not in ALLOWED_DIRECTORIES and parts != ["index.html"]:
        return False
    candidate = root.joinpath(*parts)
    try:
        candidate.resolve().relative_to(root.resolve())
    except (ValueError, OSError):
        return False
    for index in range(1, len(parts) + 1):
        if root.joinpath(*parts[:index]).is_symlink():
            return False
    return not parts or candidate.is_dir() or candidate.suffix.lower() in ALLOWED_SUFFIXES


class ViewerHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        if not allowed_request(Path(self.directory), self.path):
            self.send_error(404, "Not a viewer asset")
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")
        return None

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    handler = partial(ViewerHandler, directory=str(ROOT))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError as error:
        parser.exit(1, f"Could not start the viewer: {error}. Try --port 8081.\n")
    print(f"Open http://127.0.0.1:{server.server_port}/?local=1 in Chrome, Edge, or Safari.", flush=True)
    print("House packages stay local. Press Ctrl+C here to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
