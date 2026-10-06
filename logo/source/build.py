"""Generate every MergeMate logo SVG from one set of parameters.

The symbol is a lowercase "m": two arches share a middle stem, and that stem
lands on a commit node (the merge). Everything is built on a 256-unit grid.

Output conventions (so files are easy to recolour and animate):
- No transforms: every coordinate is baked into the path data.
- The symbol is three layers: .mm-arch-left, .mm-arch-right, .mm-node
  (they overlap slightly, so moving one never opens a hairline seam).
- The wordmark is one path per letter: .mm-letter, .mm-letter-1 … -9.
- Colours are plain fill attributes on groups (.mm-mark, .mm-word, .mm-tile),
  so design tools read them and inline CSS (e.g. `.mm-mark { fill: … }`) overrides them.

Run with a Python that has fontTools (only needed for the wordmark outlines):
    python build.py
"""
import math
import pathlib

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent
SVG = ROOT / "svg"
ICONS = ROOT / "icons"
DIAGRAMS = ROOT / "diagrams"
FONT = HERE / "BricolageGrotesque-Bold.ttf"  # SIL OFL 1.1: logo use permitted

INK = "#0b0d02"
LIME = "#d4ff3a"
PAPER = "#f6f5f1"
WHITE = "#ffffff"
BLACK = "#000000"


def f(n):
    """Number → shortest clean string, 2 decimals max."""
    s = f"{n:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


# ---------------------------------------------------------------- symbol

# Regular master, small-size cut (thicker strokes, tighter counters, bigger node),
# micro cut for favicons, and a reversed cut (thinned ~5 % for light-on-dark).
CUTS = {
    "regular": dict(stem=40, counter=40, node_r=32),
    "small": dict(stem=46, counter=34, node_r=36, top=30, foot=170, x0=25),
    "micro": dict(stem=42, counter=44, node_r=34, top=30, foot=166, x0=21, fillet=8),
    "reversed": dict(stem=38, counter=42, node_r=31, x0=29),
}


def geometry(stem=40, counter=40, node_r=32, top=32, foot=172, x0=28, fillet=10):
    """Key measurements of the symbol in 256-grid units."""
    g = dict(stem=stem, counter=counter, node_r=node_r, top=top, foot=foot, x0=x0, fillet=fillet)
    g["s1"], g["s2"], g["s3"] = x0, x0 + stem + counter, x0 + 2 * (stem + counter)
    g["R"] = stem + counter / 2
    g["r"] = counter / 2
    g["cy"] = top + g["R"]
    g["c1"], g["c2"] = g["s1"] + g["R"], g["s3"] + stem - g["R"]
    g["mid"] = (g["c1"] + g["c2"]) / 2
    g["ny"] = g["cy"] - math.sqrt(g["R"] ** 2 - (g["mid"] - g["c1"]) ** 2)
    g["ncy"] = foot + node_r / 2
    g["m1"], g["m2"] = g["s2"], g["s2"] + stem
    fdx = stem / 2 + fillet
    g["fy"] = g["ncy"] - math.sqrt((node_r + fillet) ** 2 - fdx ** 2)
    t = node_r / (node_r + fillet)
    g["tx"], g["ty"] = fdx * t, (g["fy"] - g["ncy"]) * t
    g["right"] = g["s3"] + stem
    g["bottom"] = g["ncy"] + node_r
    return g


class Place:
    """Uniform scale + offset, baked into coordinates (no transform attributes)."""

    def __init__(self, s=1.0, tx=0.0, ty=0.0):
        self.s, self.tx, self.ty = s, tx, ty

    def p(self, x, y):
        return f"{f(x * self.s + self.tx)} {f(y * self.s + self.ty)}"

    def r(self, v):
        return f(v * self.s)


def symbol_parts(cut="regular", at=Place()):
    """Three closed paths: left arch (+ left leg + middle stem), right arch (+ right leg), node."""
    g = geometry(**CUTS[cut])
    P, r = at.p, at.r
    R, ri, cy = g["R"], g["r"], g["cy"]
    left = (
        f"M{P(g['s1'], g['foot'])}V{f(cy * at.s + at.ty)}"
        f"A{r(R)} {r(R)} 0 0 1 {P(g['m2'], cy)}"
        f"V{f(g['fy'] * at.s + at.ty)}H{f(g['m1'] * at.s + at.tx)}V{f(cy * at.s + at.ty)}"
        f"A{r(ri)} {r(ri)} 0 0 0 {P(g['s1'] + g['stem'], cy)}"
        f"V{f(g['foot'] * at.s + at.ty)}Z"
    )
    right = (
        f"M{P(g['m1'], cy)}A{r(R)} {r(R)} 0 0 1 {P(g['right'], cy)}"
        f"V{f(g['foot'] * at.s + at.ty)}H{f(g['s3'] * at.s + at.tx)}V{f(cy * at.s + at.ty)}"
        f"A{r(ri)} {r(ri)} 0 0 0 {P(g['m2'], cy)}Z"
    )
    # Node + fillets; starts 8 units up inside the stem so the layers overlap.
    lap = g["fy"] - 8
    node = (
        f"M{P(g['m2'], lap)}V{f(g['fy'] * at.s + at.ty)}"
        f"A{r(g['fillet'])} {r(g['fillet'])} 0 0 0 {P(g['mid'] + g['tx'], g['ncy'] + g['ty'])}"
        f"A{r(g['node_r'])} {r(g['node_r'])} 0 1 1 {P(g['mid'] - g['tx'], g['ncy'] + g['ty'])}"
        f"A{r(g['fillet'])} {r(g['fillet'])} 0 0 0 {P(g['m1'], g['fy'])}"
        f"V{f(lap * at.s + at.ty)}Z"
    )
    return left, right, node


def symbol_group(fill, cut="regular", at=Place()):
    left, right, node = symbol_parts(cut, at)
    return (
        f'<g class="mm-mark" fill="{fill}">'
        f'<path class="mm-arch-left" d="{left}"/>'
        f'<path class="mm-arch-right" d="{right}"/>'
        f'<path class="mm-node" d="{node}"/>'
        f"</g>"
    )


def symbol_stroke(color, cut="regular"):
    """Centre-line version for draw-on animation (stroke-dasharray with pathLength=1).

    Visually identical to the filled mark except the stem→node fillets.
    """
    g = geometry(**CUTS[cut])
    sw, R0 = g["stem"], g["R"] - g["stem"] / 2
    x1, x2, x3 = g["s1"] + sw / 2, g["m1"] + sw / 2, g["s3"] + sw / 2
    cy = g["cy"]
    arches = (
        f"M{f(x1)} {f(g['foot'])}V{f(cy)}A{f(R0)} {f(R0)} 0 0 1 {f(x2)} {f(cy)}"
        f"A{f(R0)} {f(R0)} 0 0 1 {f(x3)} {f(cy)}V{f(g['foot'])}"
    )
    # starts inside the arches so the butt cap never sits on a shared edge (no seam)
    stem = f"M{f(x2)} {f(cy - g['r'])}V{f(g['ncy'])}"
    return (
        f'<g class="mm-mark" fill="none" stroke="{color}" stroke-width="{f(sw)}">'
        f'<path class="mm-arches" pathLength="1" d="{arches}"/>'
        f'<path class="mm-stem" pathLength="1" d="{stem}"/>'
        f"</g>"
        f'<circle class="mm-node" fill="{color}" cx="{f(g["mid"])}" cy="{f(g["ncy"])}" r="{f(g["node_r"])}"/>'
    )


# ---------------------------------------------------------------- wordmark

def wordmark_letters(size, x0, baseline, text="mergemate", tracking=-0.03):
    """One baked path per letter. Returns (list of d, total advance, x-height, descender)."""
    font = TTFont(FONT)
    gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
    k = size / font["head"].unitsPerEm
    out, x = [], 0.0
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
        gs[g].draw(TransformPen(pen, (k, 0, 0, -k, x0 + x, baseline)))
        out.append(pen.getCommands())
        x += hmtx[g][0] * k + tracking * size
    x -= tracking * size
    return out, x, font["OS/2"].sxHeight * k, -font["hhea"].descent * k


def word_group(fill, letters):
    paths = "".join(
        f'<path class="mm-letter mm-letter-{i}" d="{d}"/>' for i, d in enumerate(letters, 1))
    return f'<g class="mm-word" fill="{fill}">{paths}</g>'


# ---------------------------------------------------------------- files

def svg(view, body, title="MergeMate logo"):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}" role="img">'
        f"<title>{title}</title>{body}</svg>\n"
    )


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path.name


def tile(rx, fill=LIME, size=256):
    rxa = f' rx="{f(rx)}"' if rx else ""
    return f'<rect class="mm-tile" width="{size}" height="{size}"{rxa} fill="{fill}"/>'


# mark placement on a 256 tile (small cut, optically raised ~3 units)
ICON_PLACE = Place(0.62, 48.6, 45)
FAVICON_PLACE = Place(0.86, 17.9, 19.8)


def build_symbols():
    full = "0 0 256 256"
    variants = {
        "mergemate-symbol.svg": symbol_group(INK),
        "mergemate-symbol-black.svg": symbol_group(BLACK),
        "mergemate-symbol-small.svg": symbol_group(INK, "small"),
        "mergemate-symbol-lime.svg": symbol_group(LIME, "reversed"),
        "mergemate-symbol-white.svg": symbol_group(WHITE, "reversed"),
        "mergemate-symbol-stroke.svg": symbol_stroke(INK),
    }
    return [write(SVG / n, svg(full, b)) for n, b in variants.items()]


def build_lockups():
    s_top, s_foot = 32, 172
    # wordmark x-height = 62 % of the symbol's arch height
    _, _, xh1, _ = wordmark_letters(176, 0, 0)
    size = 176 * (s_foot - s_top) * 0.62 / xh1
    names = []

    # Horizontal: wordmark baseline on the symbol's feet
    wx = 228 + 72
    letters, ww, xh, desc = wordmark_letters(size, wx, s_foot)
    width = f(wx + ww + 28)
    for name, sym, word, cut in [
        ("mergemate-horizontal.svg", INK, INK, "regular"),
        ("mergemate-horizontal-black.svg", BLACK, BLACK, "regular"),
        ("mergemate-horizontal-on-dark.svg", LIME, PAPER, "reversed"),
        ("mergemate-horizontal-white.svg", WHITE, WHITE, "reversed"),
        ("mergemate-horizontal-lime.svg", LIME, LIME, "reversed"),
    ]:
        names.append(write(SVG / name, svg(
            f"0 0 {width} 256", symbol_group(sym, cut) + word_group(word, letters))))

    # Stacked: symbol centred above the wordmark
    sw = max(ww, 256) + 56
    sx = (sw - 256) / 2
    wy = 220 + 40 + xh
    sh = wy + desc + 28
    letters_s, *_ = wordmark_letters(size, (sw - ww) / 2, wy)
    for name, sym, word, cut in [
        ("mergemate-stacked.svg", INK, INK, "regular"),
        ("mergemate-stacked-on-dark.svg", LIME, PAPER, "reversed"),
        ("mergemate-stacked-white.svg", WHITE, WHITE, "reversed"),
    ]:
        names.append(write(SVG / name, svg(
            f"0 0 {f(sw)} {f(sh)}",
            symbol_group(sym, cut, Place(1, sx, 0)) + word_group(word, letters_s))))

    # Wordmark only
    letters_w, ww, xh, desc = wordmark_letters(size, 0, xh * 1.6)
    names.append(write(SVG / "mergemate-wordmark.svg", svg(
        f"0 0 {f(ww)} {f(xh * 1.6 + desc)}", word_group(INK, letters_w))))
    return names


def build_icons():
    full = "0 0 256 256"
    names = [
        # rounded tile for web/app use
        write(ICONS / "app-icon.svg", svg(full, tile(58) + symbol_group(INK, "small", ICON_PLACE))),
        # full-bleed square: iOS / Android apply their own mask
        write(ICONS / "apple-touch-icon.svg", svg(full, tile(0) + symbol_group(INK, "small", ICON_PLACE))),
        # maskable: mark stays inside the 80 % safe circle
        write(ICONS / "maskable-icon.svg", svg(full, tile(0) + symbol_group(INK, "small", ICON_PLACE))),
        # avatar: survives a circle crop
        write(ICONS / "avatar.svg", svg(
            full, f'<circle class="mm-tile" cx="128" cy="128" r="128" fill="{LIME}"/>'
            + symbol_group(INK, "small", ICON_PLACE))),
        # favicon: micro cut, larger in the tile so it holds at 32 px
        write(ICONS / "favicon.svg", svg(full, tile(56) + symbol_group(INK, "micro", FAVICON_PLACE))),
        write(ICONS / "favicon-dark.svg", svg(full, tile(56, INK) + symbol_group(LIME, "micro", FAVICON_PLACE))),
    ]
    # 16 px: drawn on the pixel grid (crisp edges); layers mirror the master
    px = (
        '<g class="mm-mark" fill="{ink}">'
        '<path class="mm-arch-left" d="M4 2H8V3H9V10H7V4H5V10H3V3H4Z"/>'
        '<path class="mm-arch-right" d="M8 2H12V3H13V10H11V4H8Z"/>'
        '<path class="mm-node" d="M7 9H9V10H10V13H9V14H7V13H6V10H7Z"/>'
        "</g>"
    ).format(ink=INK)
    names.append(write(ICONS / "favicon-16.svg", (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" role="img" shape-rendering="crispEdges">'
        f'<title>MergeMate logo</title><rect class="mm-tile" width="16" height="16" rx="3.5" fill="{LIME}"'
        f' shape-rendering="geometricPrecision"/>{px}</svg>\n')))
    write(ICONS / "site.webmanifest", """{
  "name": "MergeMate",
  "short_name": "MergeMate",
  "icons": [
    { "src": "/icon.svg", "sizes": "any", "type": "image/svg+xml" },
    { "src": "/maskable-icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "maskable" }
  ],
  "theme_color": "#08080a",
  "background_color": "#08080a",
  "display": "standalone"
}
""")
    return names


def build_diagram():
    """Construction + clear-space diagram, drawn in the symbol's own 256-grid units."""
    g = geometry(**CUTS["regular"])
    left, right, node = symbol_parts()
    GUIDE, ACC, FAINT = "#8d8c96", "#7a5cff", "#d9d8d2"
    s1, s2, s3, st = g["s1"], g["s2"], g["s3"], g["stem"]
    cy, R, ri = g["cy"], g["R"], g["r"]
    bx0, by0, bx1, by1 = s1, g["top"], g["right"], g["bottom"]
    cs = 2 * g["node_r"]  # clear space = node diameter
    el = []

    # paper + 4-unit grid
    el.append(f'<rect class="dg-paper" x="-72" y="-72" width="400" height="404" fill="{PAPER}"/>')
    grid = "".join(f"M{x} -72V332" for x in range(-72, 329, 8)) + "".join(
        f"M-72 {y}H328" for y in range(-72, 333, 8))
    el.append(f'<path class="dg-grid" d="{grid}" stroke="{FAINT}" stroke-width=".25" fill="none"/>')

    # clear space
    el.append(
        f'<rect class="dg-clearspace" x="{f(bx0 - cs)}" y="{f(by0 - cs)}" width="{f(bx1 - bx0 + 2 * cs)}" '
        f'height="{f(by1 - by0 + 2 * cs)}" fill="none" stroke="{ACC}" stroke-width=".75" stroke-dasharray="4 3"/>')
    el.append(f'<rect class="dg-bounds" x="{f(bx0)}" y="{f(by0)}" width="{f(bx1 - bx0)}" '
              f'height="{f(by1 - by0)}" fill="none" stroke="{GUIDE}" stroke-width=".5"/>')
    # node-diameter callout in the clear-space corner
    el.append(f'<circle class="dg-callout" cx="{f(bx1 + cs / 2)}" cy="{f(by1 + cs / 2)}" r="{f(g["node_r"])}" '
              f'fill="none" stroke="{ACC}" stroke-width=".75"/>')

    # the mark
    el.append(f'<g class="mm-mark" fill="#dddcd4"><path d="{left}"/><path d="{right}"/>'
              f'<path d="{node}"/></g>')

    # construction circles
    circ = [(g["c1"], cy, R), (g["c2"], cy, R), (g["c1"], cy, ri), (g["c2"], cy, ri),
            (g["mid"], g["ncy"], g["node_r"])]
    fx = g["mid"] + st / 2 + g["fillet"]
    circ += [(fx, g["fy"], g["fillet"]), (2 * g["mid"] - fx, g["fy"], g["fillet"])]
    el.append('<g class="dg-construction" fill="none" stroke="%s" stroke-width=".75">' % ACC
              + "".join(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(rr)}"/>' for x, y, rr in circ)
              + "</g>")
    el.append('<g class="dg-centres" fill="%s">' % ACC + "".join(
        f'<circle cx="{f(x)}" cy="{f(y)}" r="1.5"/>' for x, y, _ in circ[:2] + circ[4:5]) + "</g>")

    # guides
    gl = "".join(f"M{f(x)} -40V300" for x in (s1, s1 + st, s2, s2 + st, s3, s3 + st))
    gl += "".join(f"M-40 {f(y)}H296" for y in (g["top"], cy, g["foot"], by1))
    el.append(f'<path class="dg-guides" d="{gl}" stroke="{GUIDE}" stroke-width=".4" '
              f'stroke-dasharray="2 2" fill="none"/>')

    # dimensions (stems / counters) along the top
    dims, labels = [], []
    xs = [s1, s1 + st, s2, s2 + st, s3, s3 + st]
    y = -12
    for a, b in zip(xs, xs[1:]):
        dims.append(f"M{f(a)} {y}H{f(b)}M{f(a)} {y - 3}V{y + 3}M{f(b)} {y - 3}V{y + 3}")
        labels.append((f((a + b) / 2), y - 5, f(b - a)))
    el.append(f'<path class="dg-dims" d="{"".join(dims)}" stroke="{INK}" stroke-width=".6" fill="none"/>')

    txt = lambda x, y, s, anchor="middle", fill=INK: (
        f'<text x="{x}" y="{y}" text-anchor="{anchor}" fill="{fill}">{s}</text>')
    t = [txt(x, y, s) for x, y, s in labels]
    t += [
        txt(f(g["c1"]), f(cy - R - 6), f"R{f(R)}", fill=ACC),
        txt(f(g["c2"]), f(cy - R - 6), f"R{f(R)}", fill=ACC),
        txt(f(g["c1"]), f(cy + 12), f"r{f(ri)}", fill=ACC),
        txt(f(g["c2"]), f(cy + 12), f"r{f(ri)}", fill=ACC),
        txt(f(g["mid"]), f(g["ncy"] + 12), f"r{f(g['node_r'])}", fill=ACC),
        txt(f(fx + g["fillet"] + 3), f(g["fy"] + 3), f"r{f(g['fillet'])} fillet", "start", ACC),
        txt(f(bx1 + cs / 2), f(by1 + cs / 2 + 3), f"Ø {f(cs)}", fill=ACC),
        txt(f(bx0 - cs + 4), f(by0 - cs - 5), "clear space = node diameter", "start", ACC),
        txt("-62", f(g["top"] + 3), f"{f(g['top'])}", "start", GUIDE),
        txt("-62", f(cy + 3), f"{f(cy)}", "start", GUIDE),
        txt("-62", f(g["foot"] + 3), f"{f(g['foot'])}", "start", GUIDE),
        txt("-62", f(by1 + 3), f"{f(by1)}", "start", GUIDE),
        txt("-62", "-60", "MergeMate symbol · construction (256 grid)", "start"),
    ]
    el.append('<g class="dg-labels" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" '
              'font-size="7">' + "".join(t) + "</g>")
    return write(DIAGRAMS / "construction.svg", svg("-72 -72 400 404", "".join(el),
                                                    "MergeMate symbol construction"))


def main():
    out = build_symbols() + build_lockups() + build_icons() + [build_diagram()]
    print("wrote", len(out), "files:", ", ".join(out))


if __name__ == "__main__":
    main()
