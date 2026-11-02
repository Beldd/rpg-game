#!/usr/bin/env python3
"""
Local development server for Fantasy of Arcadia.

    python tools/serve.py            (or: npm run serve)

Compared with `python -m http.server`:
  * Listens ONLY on 127.0.0.1, so other devices on your network cannot reach it.
    (The plain command listens on every network interface.)
  * Serves only this repository, whichever folder you start it from.
  * Refuses hidden files and folders (.git, .env, ...) and never lists folders.
  * Tells the browser not to cache, so a normal refresh shows your latest edits.
  * Shuts itself down after 120 minutes with no requests, so a server you forgot
    about on stepping away does not stay up. Change it with --idle-minutes
    (0 turns the timeout off). Press Ctrl+C to stop it sooner.
"""
import argparse
import http.server
import os
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


class Handler(http.server.SimpleHTTPRequestHandler):
    last_request = time.time()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _allowed(self):
        Handler.last_request = time.time()
        # Check the file the server is actually about to open (after URL
        # decoding), not the raw text, so %2e%67it/config cannot slip past.
        target = os.path.abspath(self.translate_path(self.path))
        rel = os.path.relpath(target, ROOT)
        parts = [p for p in rel.replace('\\', '/').split('/') if p not in ('', '.')]
        if rel.startswith('..') or any(p.startswith('.') for p in parts):
            self.send_error(404, 'Not found')
            return False
        return True

    def do_GET(self):
        if self._allowed():
            super().do_GET()

    def do_HEAD(self):
        if self._allowed():
            super().do_HEAD()

    def list_directory(self, path):
        self.send_error(404, 'Not found')  # no folder listings
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description='Local dev server (this machine only).')
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--idle-minutes', type=float, default=120,
                    help='stop after this many minutes without a request (0 = never)')
    args = ap.parse_args()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Serving {ROOT}')
    print(f'Open http://localhost:{args.port}/   (this computer only)')
    note = f'stops after {args.idle_minutes:g} idle minutes, ' if args.idle_minutes else ''
    print(f'{note}Ctrl+C to stop.')

    if args.idle_minutes:
        def watchdog():
            while True:
                time.sleep(5)
                if time.time() - Handler.last_request > args.idle_minutes * 60:
                    print(f'No requests for {args.idle_minutes:g} minutes; stopping the server.')
                    server.shutdown()
                    return
        threading.Thread(target=watchdog, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
