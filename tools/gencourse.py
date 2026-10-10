# 直線と45/90/180度の定半径コーナーを並べてコースの点列を作る（実際の組み立てコース風）
# 実行: python3 tools/gencourse.py > src/data/courses/<id>.json の points に使う
import json, math, sys

def build(segs, step=4.0):
    x = z = 0.0
    h = 0.0  # 進行方向（ラジアン、0=+x）
    pts = [(x, z)]
    for s in segs:
        if s[0] == 'S':
            n = max(1, round(s[1] / step))
            for _ in range(n):
                x += math.cos(h) * s[1] / n; z += math.sin(h) * s[1] / n; pts.append((x, z))
        else:
            sign = 1 if s[0] == 'L' else -1
            ang = math.radians(s[1]); r = s[2]
            n = max(2, round(r * ang / step))
            for _ in range(n):
                da = ang / n
                # 円弧を弦でたどる
                x += math.cos(h + sign * da / 2) * 2 * r * math.sin(da / 2)
                z += math.sin(h + sign * da / 2) * 2 * r * math.sin(da / 2)
                h += sign * da
                pts.append((x, z))
    return pts, (x, z), math.degrees(h)

def course(a, b):
    R, HP = 16, 12
    return [
        ('S', a), ('L', 90, R), ('S', 70), ('L', 45, R), ('S', 24), ('R', 45, R), ('S', 50),
        ('L', 90, R), ('S', 90), ('L', 180, HP), ('S', 36), ('R', 180, HP), ('S', 36), ('L', 90, R),
        ('S', b), ('L', 45, R), ('S', 30), ('L', 45, R), ('S', 20),
    ]

def triple(a, b):
    # 3レーン立体交差コース: 最初の直線 a に立体交差を置く
    R = 12
    return [
        ('S', a), ('L', 90, R), ('S', b), ('L', 45, R), ('S', 20), ('R', 45, R), ('S', 30),
        ('L', 90, R), ('S', 80), ('L', 90, R), ('S', 30), ('R', 90, R), ('S', 24), ('L', 90, R), ('S', 24), ('L', 90, R), ('S', 10),
    ]

LAYOUTS = {'circuit': course, 'triple': triple}

if __name__ == '__main__':
    course = LAYOUTS[sys.argv[1] if len(sys.argv) > 1 else 'circuit']
    # 最初の直線(a)と最終コーナー手前の直線(b)の長さを変えて、ぐるっと一周して始点に戻るように合わせる
    best = None
    for a in range(40, 260, 1):
        for b in range(10, 260, 1):
            pts, end, h = build(course(a, b))
            gap = math.hypot(*end)
            if best is None or gap < best[0]:
                best = (gap, a, b, pts, h)
    gap, a, b, pts, h = best
    print(json.dumps({'a': a, 'b': b, 'gap': round(gap, 2), 'heading': round(h, 1), 'n': len(pts)}), file=sys.stderr)
    print(json.dumps([[round(x, 1), round(z, 1), 0] for x, z in pts[:-1]]))
