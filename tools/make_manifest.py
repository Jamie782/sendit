"""Builds website/play from the game files and writes play/manifest.json, which the desktop app
checks to update itself. Run from the project folder:  python3 tools/make_manifest.py <website folder>"""
import hashlib, json, os, shutil, sys
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
site = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'website'))
play = os.path.join(site, 'play')
version = json.load(open(os.path.join(here, 'version.json')))['version']
MIN_SHELL = '1.5.0'  # raise this only when main.js changes, so older apps are told to re-download
shutil.rmtree(play, ignore_errors=True); os.makedirs(play)
for item in ['index.html', 'style.css', 'version.json', 'discord.json', 'src', 'vendor', 'assets']:
    src = os.path.join(here, item)
    (shutil.copytree if os.path.isdir(src) else shutil.copy2)(src, os.path.join(play, item))
lock = os.path.join(play, 'assets', 'logo-lockup.png')
if os.path.exists(lock): os.remove(lock)
files = []
for root, _, names in os.walk(play):
    for n in sorted(names):
        full = os.path.join(root, n); rel = os.path.relpath(full, play).replace(os.sep, '/')
        files.append({'path': rel, 'sha256': hashlib.sha256(open(full, 'rb').read()).hexdigest()})
notes = sys.argv[2] if len(sys.argv) > 2 else ''
json.dump({'version': version, 'minShell': MIN_SHELL, 'notes': notes, 'files': files}, open(os.path.join(play, 'manifest.json'), 'w'), indent=1)
print(f'play/ {version}: {len(files)} files')
