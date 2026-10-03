"""A broken black brick wall, generated: running-bond bricks in near-black,
bevelled, stained, chipped at the corners, cracked, with a few knocked out."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

rng = np.random.default_rng(31)
W, H = 1920, 1080
BW, BH, M = 132, 46, 7          # brick width, height, mortar

def smooth_noise(scale):
    """Unit-variance noise that varies over about `scale` pixels."""
    small = rng.normal(0, 1, (H // scale + 3, W // scale + 3)).astype(np.float32)
    big = Image.fromarray(small, "F").resize(((W // scale + 3) * scale, (H // scale + 3) * scale), Image.BICUBIC)
    return np.asarray(big)[:H, :W]

def blur_mask(a, r):
    """Blur a 0..1 mask."""
    return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))) / 255.0

# Mortar bed: dark, gritty.
img = np.full((H, W), 15.0) + rng.normal(0, 3.0, (H, W))
mask_any = np.zeros((H, W), bool)

holes = Image.new("L", (W, H), 0)
hd = ImageDraw.Draw(holes)
chips = Image.new("L", (W, H), 0)
cd = ImageDraw.Draw(chips)

stain = smooth_noise(70) * 6        # broad water stains
stain2 = smooth_noise(14) * 3

rows = H // (BH + M) + 2
for r in range(-1, rows):
    y0 = r * (BH + M) + 3
    off = (BW + M) // 2 if r % 2 else 0
    for c in range(-1, W // (BW + M) + 2):
        x0 = c * (BW + M) - off + 3
        x1, y1 = x0 + BW, y0 + BH
        xa, ya, xb, yb = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
        if xa >= xb or ya >= yb:
            continue
        base = rng.uniform(24, 40)
        brick = np.full((yb - ya, xb - xa), base)
        brick += rng.normal(0, 4.5, brick.shape)                     # grain
        brick += stain[ya:yb, xa:xb] + stain2[ya:yb, xa:xb]
        # bevel: lit top-left, shadowed bottom-right
        yy, xx = np.mgrid[ya:yb, xa:xb]
        brick += np.where(yy - y0 < 2, 9, 0) + np.where(xx - x0 < 2, 5, 0)
        brick -= np.where(y1 - yy <= 3, 12, 0) + np.where(x1 - xx <= 2, 7, 0)
        img[ya:yb, xa:xb] = brick
        mask_any[ya:yb, xa:xb] = True

        # chipped corners and edges
        if rng.random() < 0.42:
            cx = x0 if rng.random() < 0.5 else x1
            cy = y0 if rng.random() < 0.5 else y1
            sx, sy = (1 if cx == x0 else -1), (1 if cy == y0 else -1)
            pts = [(cx, cy)] + [(cx + sx * rng.uniform(4, 20), cy + sy * rng.uniform(2, 12)) for _ in range(4)]
            cd.polygon(pts, fill=255)
        # a few knocked clean out
        if rng.random() < 0.05:
            jag = [(x0 + rng.uniform(-14, 10), y0 + rng.uniform(-10, 8)),
                   (x0 + BW * rng.uniform(.3, .7), y0 + rng.uniform(-12, 6)),
                   (x1 + rng.uniform(-10, 14), y0 + rng.uniform(-8, 10)),
                   (x1 + rng.uniform(-6, 16), y1 + rng.uniform(-10, 10)),
                   (x0 + BW * rng.uniform(.3, .7), y1 + rng.uniform(-6, 14)),
                   (x0 + rng.uniform(-16, 8), y1 + rng.uniform(-10, 10))]
            hd.polygon(jag, fill=255)

# A few bigger breaks, two or three bricks wide, out towards the edges where
# they frame the middle rather than sit behind the words.
for _ in range(5):
    side = rng.choice([-1, 1])
    cx = W / 2 + side * rng.uniform(W * 0.28, W * 0.48)
    cy = rng.uniform(H * 0.12, H * 0.9)
    n = int(rng.integers(9, 14))
    ang = np.sort(rng.uniform(0, np.pi * 2, n))
    rad = rng.uniform(70, 150) * rng.uniform(0.55, 1.0, n)
    hd.polygon([(cx + np.cos(a) * r * 1.5, cy + np.sin(a) * r * 0.75) for a, r in zip(ang, rad)], fill=255)

# Chips: the face broken back to rougher, darker brick, with a pale rim -
# only on brick, never spilling into the mortar.
chip = np.asarray(chips.filter(ImageFilter.GaussianBlur(0.8))) / 255.0 * mask_any
rim = np.clip(np.asarray(chips.filter(ImageFilter.MaxFilter(3))) / 255.0 - chip, 0, 1) * mask_any
img = img * (1 - chip) + (img - 12 + rng.normal(0, 5, (H, W))) * chip + rim * 9

# Holes: deep black, an inner shadow, a lit broken edge.
hole = np.asarray(holes.filter(ImageFilter.GaussianBlur(1.2))) / 255.0
edge = np.clip(np.asarray(holes.filter(ImageFilter.MaxFilter(7))) / 255.0 - hole, 0, 1)
depth = blur_mask(hole, 10)
img = img * (1 - hole) + (3 + 6 * (1 - depth)) * hole + edge * 14

# Cracks: random walks, dark with a faint lit lip.
cracks = Image.new("L", (W, H), 0)
lit = Image.new("L", (W, H), 0)
kd, ld = ImageDraw.Draw(cracks), ImageDraw.Draw(lit)
for _ in range(26):
    x, y = rng.uniform(0, W), rng.uniform(0, H)
    ang = rng.uniform(0, np.pi * 2)
    pts = [(x, y)]
    for _ in range(int(rng.integers(12, 40))):
        ang += rng.normal(0, 0.45)
        step = rng.uniform(6, 16)
        x, y = x + np.cos(ang) * step, y + np.sin(ang) * step
        pts.append((x, y))
        if rng.random() < 0.06:  # a branch
            bx, by, ba = x, y, ang + rng.choice([-1, 1]) * rng.uniform(.6, 1.2)
            bpts = [(bx, by)]
            for _ in range(int(rng.integers(4, 12))):
                ba += rng.normal(0, .5)
                bx, by = bx + np.cos(ba) * 8, by + np.sin(ba) * 8
                bpts.append((bx, by))
            kd.line(bpts, fill=200, width=1)
    kd.line(pts, fill=255, width=2)
    ld.line([(px + 1, py - 1) for px, py in pts], fill=120, width=1)
img -= np.asarray(cracks.filter(ImageFilter.GaussianBlur(0.6))) / 255.0 * 16
img += np.asarray(lit.filter(ImageFilter.GaussianBlur(0.5))) / 255.0 * 7

# Light: a dim wash from above, falling off to black at the edges and floor.
yy, xx = np.mgrid[0:H, 0:W]
nx, ny = (xx - W / 2) / (W / 2), (yy - H * 0.38) / (H * 0.75)
light = np.clip(1.15 - (nx ** 2 * 0.55 + ny ** 2), 0.18, 1.1)
img = img * light
img += rng.normal(0, 2.0, (H, W))           # film grain over everything

g = np.clip(img, 0, 255)
# A faint cold-to-warm tint so it isn't dead grey: blue-black stone.
rgb = np.dstack([g * 0.97, g * 0.98, g * 1.04]).clip(0, 255).astype(np.uint8)
out = Image.fromarray(rgb, "RGB")
out.save(sys.argv[1], quality=78, method=4)
out.resize((480, 270), Image.LANCZOS).save(sys.argv[2], quality=85)
print(out.size)
