from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys


fixture = Path(__file__).parent
destination = Path(sys.argv[1])
destination.mkdir()
upstream = destination.parent / 'pinned-upstream'
upstream.mkdir()
inputs = json.loads((fixture / 'inputs.json').read_text())


def git(directory, *args):
    return subprocess.check_output(['git', '-C', str(directory), *args]).decode().strip()


def fetch(name, url, rev):
    directory = upstream / name
    directory.mkdir()
    git(directory, 'init', '-q')
    git(directory, 'fetch', '--depth=1', '--no-tags', url, rev)
    git(directory, 'checkout', '--detach', 'FETCH_HEAD')
    if git(directory, 'rev-parse', 'HEAD') != rev:
        raise ValueError(f'{name} revision differs from its pin')
    return directory


oai = fetch('oai', 'https://github.com/openai/math.git', '1581d4cbdd69a0faf34b2089614fe2a814316a6a')
pnt = fetch('pnt', 'https://github.com/AlexKontorovich/PrimeNumberTheoremAnd.git', 'c39a751132c88b6e8080b74c74023fd95b3d8be0')
stacks = fetch('stacks', 'https://github.com/AxiomMath/Stacks.git', '5ed82d14634e8d9576bb844c7bd4e3da66d450e7')
patch = oai / 'lean/patches/PrimeNumberTheoremAnd-lean4341.patch'
if sha256(patch.read_bytes()).hexdigest() != '0890432340c0025973bcfe070b634355fa366cc831595f68526e4c73c8903d82':
    raise ValueError('Unexpected PrimeNumberTheoremAnd patch')
git(pnt, 'apply', '--', str(patch.resolve()))


def copy_checked(source, target, digest):
    data = source.read_bytes()
    if sha256(data).hexdigest() != digest:
        raise ValueError(f'Pinned source differs: {source}')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


roots = {'oai': oai / 'lean', 'pnt': pnt, 'stacks': stacks}
for item in inputs['files']:
    path = Path(item['path'])
    if path.is_absolute() or '..' in path.parts or path.suffix != '.lean':
        raise ValueError(f'Unsafe pinned dependency path {path}')
    copy_checked(roots[item['kind']] / path, destination / path, item['sha256'])
for name, digest in inputs['config'].items():
    copy_checked(fixture / name, destination / name, digest)
print(f"Verified {len(inputs['files'])} public Lean inputs and the exact compiler and package configuration")
