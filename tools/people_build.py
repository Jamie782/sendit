# Builds SEND IT's people from the CC0 MakeHuman base mesh, targets, game_engine rig and weights.
# Output: people.json (bones, groups, layout) + people.bin (geometry for each body type and LOD).
import gzip, json, struct, sys, numpy as np
from scipy.spatial import cKDTree
import pyfqmr

MH = '/tmp/claude-0/-home-claude/19feb824-954f-5030-a79a-4fb675745ec9/scratchpad/dl/makehumancommunity_mpfb2/src/mpfb/data/'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/send-it/assets/people/'

# ── base mesh ──
V, VT, F, FG = [], [], [], []
grp = None
for line in open(MH + '3dobjs/base.obj'):
    if line.startswith('v '): V.append([float(x) for x in line.split()[1:4]])
    elif line.startswith('vt '): VT.append([float(x) for x in line.split()[1:3]])
    elif line.startswith('g '): grp = line.split()[1]
    elif line.startswith('f '):
        F.append([tuple(int(i) - 1 for i in c.split('/')[:2]) for c in line.split()[1:]]); FG.append(grp)
V = np.array(V); VT = np.array(VT)
VG = json.load(open(MH + 'mesh_metadata/basemesh_vertex_groups.json'))
def gverts(name): return np.concatenate([np.arange(a, b + 1) for a, b in VG[name]])

def target(name):
    d = np.zeros_like(V)
    for line in gzip.open(MH + 'targets/macrodetails/' + name + '.target.gz').read().decode().splitlines():
        p = line.split()
        if len(p) == 4 and not line.startswith('#'): d[int(p[0])] = [float(x) for x in p[1:]]
    return d
ETH = ['african', 'asian', 'caucasian']
def body(gender, age='young', muscle={'averagemuscle': 1}, weight={'averageweight': 1}):
    v = V.copy()
    for m, wm in muscle.items():
        for w, ww in weight.items():
            v += target(f'universal-{gender}-{age}-{m}-{w}') * wm * ww
    for e in ETH: v += target(f'{e}-{gender}-{age}') / 3
    return v

RIG = json.load(open(MH + 'rigs/standard/rig.game_engine.json'))
W = json.load(open(MH + 'rigs/standard/weights.game_engine.json'))['weights']
# keep the bones we drive (fingers kept so hands can grip)
BONES = [b for b in RIG if b != 'Root']
order = []
def visit(b):
    if b in order: return
    p = RIG[b]['parent']
    if p and p != 'Root': visit(p)
    order.append(b)
for b in BONES: visit(b)
BONES = order
BI = {b: i for i, b in enumerate(BONES)}

def joint(v, spec):
    if spec['strategy'] == 'CUBE': return v[gverts(spec['cube_name'])].mean(0)
    return v[spec['vertex_indices']].mean(0)

# ── weights: top 4 per vertex ──
NV = len(V)
wl = [[] for _ in range(NV)]
for b, lst in W.items():
    if b not in BI: continue
    for vi, w in lst: wl[vi].append((w, BI[b]))
SKI = np.zeros((NV, 4), np.uint16); SKW = np.zeros((NV, 4), np.float32)
for i, l in enumerate(wl):
    l.sort(reverse=True); l = l[:4]
    s = sum(w for w, _ in l) or 1
    for k, (w, b) in enumerate(l): SKI[i, k] = b; SKW[i, k] = w / s
DOM = np.array([BONES[SKI[i, 0]] for i in range(NV)])

# ── faces we keep: body + eyeballs ──
KEEP = {'body', 'helper-l-eye', 'helper-r-eye'}
faces = [(f, g) for f, g in zip(F, FG) if g in KEEP]

def regions(v):
    """per vertex: 0 face/neck skin, 1 top, 2 forearm, 3 pants, 4 shoes, 5 hands, 6 hair, 7 eyes"""
    j = lambda n: v[gverts(n)].mean(0)
    eye = (j('joint-l-eye') + j('joint-r-eye')) / 2
    neck = j('joint-neck'); hip = j('joint-pelvis'); ankL = j('joint-l-ankle'); headJ = j('joint-head')
    R = np.zeros(NV, np.int8)
    for i in range(NV):
        b = DOM[i]; y, z = v[i, 1], v[i, 2]
        if b in ('head',) or b == 'neck_01':
            r = 0
            if b == 'neck_01' and y < neck[1] + 0.25: r = 1  # collar
            if b == 'head':
                if y > eye[1] + 0.42 or (z < eye[2] - 0.95 and y > eye[1] - 0.55) or (z < eye[2] - 0.55 and y > eye[1] + 0.12): r = 6
            R[i] = r
        elif b.startswith(('spine', 'clavicle', 'upperarm')): R[i] = 1
        elif b == 'pelvis': R[i] = 1 if y > hip[1] + 0.25 else 3
        elif b.startswith('lowerarm'): R[i] = 2
        elif b.startswith(('hand', 'index', 'middle', 'ring', 'pinky', 'thumb')): R[i] = 5
        elif b.startswith(('thigh',)): R[i] = 3
        elif b.startswith('calf'): R[i] = 4 if y < ankL[1] + 0.32 else 3
        elif b.startswith(('foot', 'ball')): R[i] = 4
        else: R[i] = 1
    R[gverts('helper-l-eye')] = 7; R[gverts('helper-r-eye')] = 7
    return R

INFL = {0: 0, 1: 0.11, 2: 0.09, 3: 0.07, 4: 0.16, 5: 0, 6: 0.09, 7: 0}  # decimetres

def vnormals(v, tris):
    n = np.zeros_like(v)
    fn = np.cross(v[tris[:, 1]] - v[tris[:, 0]], v[tris[:, 2]] - v[tris[:, 0]])
    for k in range(3): np.add.at(n, tris[:, k], fn)
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)

# triangles by original vertex (for normals) and unique (v, vt) render vertices
tri_v = []; tri_c = []; tri_f = []
for fi, (f, g) in enumerate(faces):
    for a, b, c in ([(0, 1, 2), (0, 2, 3)] if len(f) == 4 else [(0, 1, 2)]):
        tri_v.append([f[a][0], f[b][0], f[c][0]]); tri_c.append([f[a], f[b], f[c]]); tri_f.append(fi)
tri_v = np.array(tri_v); tri_f = np.array(tri_f)
face_v = [[c[0] for c in f] for f, g in faces]

def build_variant(v, R, freg):
    v = v.copy()
    n = vnormals(v, tri_v)
    infl = np.zeros(NV)
    for fi, fv in enumerate(face_v):
        x = INFL[min(freg[fi], 7)]
        for vi in fv:
            if x > infl[vi]: infl[vi] = x
    # eyes stay put; inflate clothes and hair along normals
    v = v + n * infl[:, None]
    # shoes: flatten a sole under the foot
    return v, vnormals(v, tri_v)

meta = {'bones': BONES, 'parents': [BI.get(RIG[b]['parent'], -1) for b in BONES], 'variants': {}, 'regions': ['skin', 'top', 'forearm', 'pants', 'shoes', 'hands', 'hair', 'eyes', 'iris']}
blobs = []
def put(arr):
    off = sum(len(b) for b in blobs); data = arr.tobytes(); pad = (-len(data)) % 4
    blobs.append(data + b'\0' * pad); return [off, len(data)]

# render topology for LOD0 (shared by all variants): split by (v, vt)
uniq = {}; rv = []; rvt = []; tris0 = []
for t in tri_c:
    row = []
    for (vi, ti) in t:
        k = (vi, ti)
        if k not in uniq: uniq[k] = len(rv); rv.append(vi); rvt.append(ti)
        row.append(uniq[k])
    tris0.append(row)
rv = np.array(rv); tris0 = np.array(tris0, np.uint32)

VARS = {
    'm': dict(gender='male', muscle={'averagemuscle': 0.55, 'maxmuscle': 0.45}),
    'f': dict(gender='female'),
    'mh': dict(gender='male', weight={'averageweight': 0.4, 'maxweight': 0.6}),
    'mo': dict(gender='male', age='old', weight={'averageweight': 0.7, 'maxweight': 0.3}),
}
R0 = None
for name, kw in VARS.items():
    v = body(**kw)
    R = regions(v)
    if R0 is None: R0 = R
    # skeleton (bone head / tail) for this body
    heads = np.array([joint(v, RIG[b]['head']) for b in BONES]); tails = np.array([joint(v, RIG[b]['tail']) for b in BONES])
    S = 0.1  # decimetres -> metres
    # region per triangle: majority of its vertices' regions (eyes win)
    eyeC = {}
    for side in 'lr':
        eyeC[side] = v[gverts(f'helper-{side}-eye')].mean(0)
    def tri_region(tv):
        rr = R[tv]
        if (rr == 7).any():
            c = v[tv].mean(0); side = 'l' if c[0] > 0 else 'r'
            d = c - eyeC[side]; d /= np.linalg.norm(d)
            return 8 if d[2] > 0.82 else 7
        vals, cnt = np.unique(rr, return_counts=True)
        return int(vals[np.argmax(cnt)])
    freg = np.array([tri_region(np.array(fv)) for fv in face_v])
    treg = freg[tri_f]
    vv, nn = build_variant(v, R, freg)
    # landmarks for clothing add-ons (rest pose, metres)
    tops = np.where(np.isin(np.arange(NV), np.unique(tri_v[treg == 1])))[0]
    def front(y0, dz=1):
        c = tops[(np.abs(vv[tops, 1] - y0) < 0.12) & (np.abs(vv[tops, 0]) < 0.25)]
        return (vv[c[np.argmax(vv[c, 2] * dz)]] * S).round(4).tolist()
    nk = joint(v, RIG['neck_01']['head'])
    lm = {'neckBack': front(nk[1] - 0.2, -1), 'chestFront': front(nk[1] - 1.0), 'bellyFront': front(joint(v, RIG['pelvis']['head'])[1] + 1.2)}
    order_t = np.argsort(treg, kind='stable')
    groups0 = []
    for r in range(9):
        idx = np.where(treg[order_t] == r)[0]
        groups0.append([int(idx[0]) * 3, int(len(idx)) * 3] if len(idx) else [0, 0])
    # LOD0
    P0 = (vv[rv] * S).astype(np.float32); N0 = (np.clip(nn[rv], -1, 1) * 127).astype(np.int8)
    ent = {'heads': (heads * S).round(5).tolist(), 'tails': (tails * S).round(5).tolist(),
           'eye': ((joint(v, {'strategy': 'CUBE', 'cube_name': 'joint-l-eye'}) + joint(v, {'strategy': 'CUBE', 'cube_name': 'joint-r-eye'})) / 2 * S).round(5).tolist(),
           'lm': lm, 'lod0': {'pos': put(P0), 'nrm': put(N0), 'groups': groups0, 'count': int(len(rv))}}
    if name == 'm':
        meta['lod0'] = {'uv': put(VT[rvt].astype(np.float32)), 'si': put(SKI[rv].astype(np.uint8)), 'sw': put((SKW[rv] * 255).round().astype(np.uint8)),
                        'idx': put(tris0[order_t].reshape(-1).astype(np.uint16)), 'count': int(len(rv))}
    # LOD1: decimate each region separately (borders kept so there are no cracks)
    lv, ln, lidx, lsi, lsw, lgroups, luv = [], [], [], [], [], [], []
    USED = np.unique(tri_v); tree = cKDTree(vv[USED])
    for r in range(9):
        tt = tri_v[treg == r]
        if not len(tt): lgroups.append([0, 0]); continue
        used, inv = np.unique(tt, return_inverse=True)
        sv = vv[used]; sf = inv.reshape(-1, 3)
        target_n = max(8, int(len(sf) * (0.2 if r < 7 else 0.5)))
        s = pyfqmr.Simplify(); s.setMesh(sv, sf); s.simplify_mesh(target_count=target_n, aggressiveness=6, preserve_border=True, verbose=False)
        dv, df, _ = s.getMesh()
        _, near = tree.query(dv); near = USED[near]
        base = sum(len(x) for x in lv)
        lgroups.append([sum(len(x) for x in lidx), len(df) * 3])
        lv.append(dv); ln.append(nn[near]); lsi.append(SKI[near]); lsw.append(SKW[near]); luv.append(VT[np.zeros(len(near), int)])
        lidx.append((df + base).reshape(-1))
    lv = np.concatenate(lv); ln = np.concatenate(ln); lidx = np.concatenate(lidx); lsi = np.concatenate(lsi); lsw = np.concatenate(lsw)
    ent['lod1'] = {'pos': put((lv * S).astype(np.float32)), 'nrm': put((np.clip(ln, -1, 1) * 127).astype(np.int8)), 'si': put(lsi.astype(np.uint8)),
                   'sw': put((lsw * 255).round().astype(np.uint8)), 'idx': put(lidx.astype(np.uint16)), 'groups': lgroups, 'count': int(len(lv))}
    meta['variants'][name] = ent
    print(name, 'lod0 verts', len(rv), 'tris', len(tris0), '| lod1 verts', len(lv), 'tris', len(lidx) // 3, 'height', round((v[:13380, 1].max() - v[:13380, 1].min()) * S, 3))

import os; os.makedirs(OUT, exist_ok=True)
open(OUT + 'people.bin', 'wb').write(b''.join(blobs))
json.dump(meta, open(OUT + 'people.json', 'w'))
print('bin', sum(len(b) for b in blobs) // 1024, 'KB')
