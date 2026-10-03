#!/usr/bin/env python3
"""HELM: machined 2x2 deck, outlined lockups and iOS icons.
Requires Pillow, fontTools, rsvg-convert on PATH and Inter Display Regular at
fonts/InterDisplay-Regular.ttf (overridable with HELM_FONT). No network needed.
"""
from pathlib import Path
import argparse
import json
import math
import os
import random
import shutil
import subprocess
import xml.etree.ElementTree as ET
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = Path(os.environ.get('HELM_FONT', ROOT / 'fonts/InterDisplay-Regular.ttf'))
RSVG = shutil.which('rsvg-convert') or 'rsvg-convert'
BODY = 'M300 100H724C858 100 924 166 924 300V724C924 858 858 924 724 924H300C166 924 100 858 100 724V300C100 166 166 100 300 100Z'
HALF, SHEET_HEIGHT = 1700, 2800


def layout():
    return [(232, 232), (534, 232), (232, 534)], 258, (663, 663), 560


def svg(width, height, content, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><title>{title}</title>{content}</svg>'


def write(path, content):
    path.write_text(content + '\n', encoding='utf-8')


def render(source, target, width, height=None):
    command = [RSVG, '-w', str(width), '-o', str(target)]
    if height is not None:
        command += ['-h', str(height)]
    subprocess.run(command + [str(source)], check=True)


def materials():
    rng = random.Random(700)
    grain = ''.join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{rng.choice(["#fff", "#000"])}" opacity=".023"/>' for y in range(64) for x in range(64) if rng.random() < .5)
    brush = ''.join(f'<path d="M0 {y + .5}H64" stroke="{"#fff" if y % 2 else "#000"}" stroke-opacity="{rng.uniform(.01, .015):.4f}" stroke-width=".5"/>' for y in range(64))
    return f'''<defs>
<path id="body" d="{BODY}"/><clipPath id="bodyClip"><use href="#body"/></clipPath>
<pattern id="grain" width="64" height="64" patternUnits="userSpaceOnUse">{grain}</pattern>
<pattern id="linearBrush" width="64" height="64" patternUnits="userSpaceOnUse">{brush}</pattern>
<linearGradient id="bodyMetal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#2a2a2c"/><stop offset=".42" stop-color="#1b1b1d"/><stop offset="1" stop-color="#0c0c0d"/></linearGradient>
<linearGradient id="bodyEdge" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".16"/><stop offset=".35" stop-color="#fff" stop-opacity=".035"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
<linearGradient id="capMetal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#333336"/><stop offset="1" stop-color="#252527"/></linearGradient>
<linearGradient id="darkCapMetal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#2b2b2e"/><stop offset="1" stop-color="#1e1e20"/></linearGradient>
<linearGradient id="capTop" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".14"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="capBottom" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
<linearGradient id="chamfer" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e8e8ea"/><stop offset=".45" stop-color="#bebec1"/><stop offset="1" stop-color="#555559"/></linearGradient>
<filter id="soften" x="-.02" y="-.02" width="1.04" height="1.04" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".7"/></filter>
</defs>'''


def squircle(x, y, size, radius=None, part='full'):
    """Quartic superellipse corner approximation with zero curvature at the flats.
    Two symmetric cubic segments per corner meet with matching curvature.
    """
    r = size * .22 if radius is None else radius
    q = 2 ** (-.25)
    controls = [(.45, 0), (2*q-1, 0), (q, 1-q), (1, 2*(1-q)), (1, .55), (1, 1)]
    corners = [lambda u,v: (x+size-r+r*u, y+r*v),
               lambda u,v: (x+size-r*v, y+size-r+r*u),
               lambda u,v: (x+r-r*u, y+size-r*v),
               lambda u,v: (x+r*v, y+r-r*u)]
    if part == 'top':
        path = f'M{x:.4f} {y+size*.3:.4f}'
        indices = (3, 0)
    elif part == 'bottom':
        path = f'M{x+size:.4f} {y+size*.7:.4f}'
        indices = (1, 2)
    else:
        path = f'M{x+r:.4f} {y:.4f}'
        indices = range(4)
    for corner in indices:
        transform = corners[corner]
        a, b = transform(0, 0)
        path += f'L{a:.4f} {b:.4f}'
        points = [transform(u,v) for u,v in controls]
        for index in (0, 3):
            path += 'C' + ' '.join(f'{a:.4f} {b:.4f}' for a,b in points[index:index+3])
    if part == 'top':
        return path + f'L{x+size:.4f} {y+size*.3:.4f}'
    if part == 'bottom':
        return path + f'L{x:.4f} {y+size*.7:.4f}'
    return path + 'Z'


def notch(weight_ratio=.05):
    _, size, (cx, cy), _ = layout()
    radius, weight = size / 2, size * weight_ratio
    # Including the round ends: length .26r, outer end .10r inside the edge.
    factors = (.90 - weight/(2*radius), .64 + weight/(2*radius))
    angle = math.radians(-135)  # 45 degrees counterclockwise from twelve o'clock.
    points = [(cx + radius * factor * math.cos(angle), cy + radius * factor * math.sin(angle)) for factor in factors]
    return 'M' + 'L'.join(f'{x:.3f} {y:.3f}' for x, y in points)


def cut_mask():
    _, size, _, _ = layout()
    return f'<mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><path d="{notch(.068)}" fill="none" stroke="#000" stroke-width="{size*.068}" stroke-linecap="round"/></mask>'


def cap(x, y, size, standalone=False, dark=False):
    path = squircle(x, y, size)
    top = squircle(x+1, y+1, size-2, size*.22-1, part='top')
    bottom = squircle(x+1, y+1, size-2, size*.22-1, part='bottom')
    top_id, bottom_id = f'cap-top-{x}-{y}', f'cap-bottom-{x}-{y}'
    content = f'<path d="{path}" fill="url(#{"darkCapMetal" if dark else "capMetal"})"/><path d="{path}" fill="url(#linearBrush)"/>'
    # Open edge paths only; gradient coordinates still span the entire inner cap.
    content += f'<defs><linearGradient id="{top_id}" href="#capTop" gradientUnits="userSpaceOnUse" x1="{x}" y1="{y+1}" x2="{x}" y2="{y+size-1}"/><linearGradient id="{bottom_id}" href="#capBottom" gradientUnits="userSpaceOnUse" x1="{x}" y1="{y+1}" x2="{x}" y2="{y+size-1}"/></defs>'
    content += f'<path d="{top}" fill="none" stroke="url(#{top_id})" stroke-width="2"/><path d="{bottom}" fill="none" stroke="url(#{bottom_id})" stroke-width="2"/>' 
    if standalone:
        edge = squircle(x+.75, y+.75, size-1.5, size*.22-.75)
        content += f'<path d="{edge}" fill="none" stroke="#8e8e93" stroke-opacity=".4" stroke-width="1.5"/>'
    return content


def dial(transparent=False):
    _, size, (cx, cy), _ = layout()
    radius, face = size / 2, size / 2 - 10
    wedges = []
    for n in range(180):
        a, b = math.radians(n * 2), math.radians(n * 2 + 2.12)
        theta = (a + b) / 2
        intensity = (1 + math.cos(2 * (theta + 3 * math.pi / 4))) / 2
        value, blue = round(138 + 94 * intensity), round(142 + 92 * intensity)
        x1, y1 = cx + radius * math.cos(a), cy + radius * math.sin(a)
        x2, y2 = cx + radius * math.cos(b), cy + radius * math.sin(b)
        wedges.append(f'<path d="M{cx} {cy}L{x1:.3f} {y1:.3f}A{radius} {radius} 0 0 1 {x2:.3f} {y2:.3f}Z" fill="#{value:02x}{value:02x}{blue:02x}"/>')
    rings = ''.join(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{"#fff" if r % 4 == 0 else "#000"}" stroke-opacity=".027" stroke-width=".85"/>' for r in range(4, math.ceil(face), 2))
    slot = notch()
    weight = size * .05
    mask = cut_mask() if transparent else ''
    mask_attribute = ' mask="url(#cut)"' if transparent else ''
    engraving = '' if transparent else f'<path d="{slot}" transform="translate(0 1)" fill="none" stroke="#e8e8ea" stroke-opacity=".55" stroke-width="{weight}" stroke-linecap="round"/><path d="{slot}" fill="none" stroke="#1a1a1c" stroke-width="{weight}" stroke-linecap="round"/>' 
    return f'''<defs>{mask}<clipPath id="face"><circle cx="{cx}" cy="{cy}" r="{face}"/></clipPath></defs>
<g clip-path="url(#face)"{mask_attribute}><circle cx="{cx}" cy="{cy}" r="{face}" fill="#bcbcbf"/>
<g filter="url(#soften)">{''.join(wedges)}{rings}</g>
<circle cx="{cx}" cy="{cy}" r="{face}" fill="url(#grain)" opacity=".45"/>
{engraving}</g><circle cx="{cx}" cy="{cy}" r="{radius-5}" fill="none" stroke="url(#chamfer)" stroke-width="10"/>'''


def deck(standalone=False, dark=False):
    cells, size, _, _ = layout()
    return ''.join(cap(x, y, size, standalone, dark) for x, y in cells) + dial(transparent=standalone)


def priority_assets():
    write(ROOT / 'logo-mark.svg', svg(1024, 1024, materials() + deck(standalone=True), 'Helm — three machined caps and dial, transparent engraved slot, no body'))
    render(ROOT / 'logo-mark.svg', ROOT / 'splash-mark.png', 512, 512)
    render(ROOT / 'logo-mark.svg', ROOT / 'logo-mark.png', 1024, 1024)
    print('Ready: HELM logo-mark.svg/png and splash-mark.png', flush=True)


def master_icon():
    body = '<use href="#body" fill="url(#bodyMetal)"/><g clip-path="url(#bodyClip)"><use href="#body" fill="url(#grain)"/><use href="#body" fill="none" stroke="url(#bodyEdge)" stroke-width="3"/>' + deck() + '</g>'
    source = ROOT / 'app-icon.svg'
    write(source, svg(1024, 1024, materials() + body, 'Helm — machined 2x2 deck, concentric dial chamfer'))
    render(source, ROOT / 'app-icon.png', 1024, 1024)


def hint_design(size):
    start, cell, gap = (3, 4, 1) if size == 16 else (6, 9, 2)
    body = '<rect x="1" y="1" width="14" height="14" rx="3.2" fill="#151517"/>' if size == 16 else '<rect x="3" y="3" width="26" height="26" rx="5.9" fill="#151517"/>'
    for row, col in [(0,0), (0,1), (1,0)]:
        x, y = start + col * (cell + gap), start + row * (cell + gap)
        body += f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" fill="#6a6a6e"/>'
    cx = cy = start + cell + gap + cell / 2
    body += f'<circle cx="{cx}" cy="{cy}" r="{cell/2}" fill="#d8d8da"/>'
    if size == 32:
        angle = math.radians(-135)
        pts = [(cx + cell/2 * factor * math.cos(angle), cy + cell/2 * factor * math.sin(angle)) for factor in (.82, .68)]
        path = 'M' + 'L'.join(f'{x:.3f} {y:.3f}' for x, y in pts)
        body += f'<path d="{path}" fill="none" stroke="#1a1a1c" stroke-width="1" stroke-linecap="round"/>'
    return body


def small_icons():
    directory = ROOT / 'app-icon'
    directory.mkdir(exist_ok=True)
    for size in (16, 32):
        source = directory / f'icon-{size}.svg'
        write(source, svg(size, size, hint_design(size), f'Helm — hand-hinted {size}px deck'))
        render(source, directory / f'icon-{size}.png', size, size)
    with Image.open(ROOT / 'app-icon.png') as master:
        for size in (180, 80, 40):
            master.resize((size, size), Image.Resampling.LANCZOS).save(directory / f'icon-{size}.png')


def wordmarks():
    with TTFont(FONT) as font:
        glyph_set, cmap = font.getGlyphSet(), font.getBestCmap()
        cap_height, height = 112, 192
        scale = cap_height / font['OS/2'].sCapHeight
        tracking = font['head'].unitsPerEm * scale * .03
        diameter = cap_height * 1.15
        cx, cy = 20 + diameter / 2, height / 2
        start = 20 + diameter + cap_height * .45
        cursor = start - font['hmtx'][cmap[ord('H')]][1] * scale
        outlines = []
        for index, char in enumerate('Helm'):
            name = cmap[ord(char)]
            pen = SVGPathPen(glyph_set)
            transformed = TransformPen(pen, (scale, 0, 0, -scale, cursor, cy + cap_height / 2))
            glyph_set[name].draw(transformed)
            outlines.append(f'<path d="{pen.getCommands()}"/>')
            cursor += font['hmtx'][name][0] * scale + (tracking if index < 3 else 0)
        width = math.ceil(cursor + 20)
    cells, size, (dial_x, dial_y), extent = layout()
    for mode, color in [('dark', '#e6e6e8'), ('light', '#1c1c1e')]:
        transform = f'translate({cx} {cy}) scale({diameter / extent}) translate(-512 -512)'
        mask = cut_mask()
        mark = ''.join(f'<path d="{squircle(x,y,size)}"/>' for x, y in cells) + f'<circle cx="{dial_x}" cy="{dial_y}" r="{size / 2}" mask="url(#cut)"/>' 
        content = f'<defs>{mask}</defs><g fill="{color}" transform="{transform}">{mark}</g><g fill="{color}">{"".join(outlines)}</g>'
        source = ROOT / f'wordmark-{mode}.svg'
        write(source, svg(width, height, content, f'Helm — {mode} outlined Inter Display Regular lockup'))
        render(source, ROOT / f'wordmark-{mode}.png', width * 2, height * 2)


CONTENTS = {'images': [
    {'filename': 'AppIcon.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
    {'appearances': [{'appearance': 'luminosity', 'value': 'dark'}], 'filename': 'AppIcon-dark.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
    {'appearances': [{'appearance': 'luminosity', 'value': 'tinted'}], 'filename': 'AppIcon-tinted.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
], 'info': {'author': 'xcode', 'version': 1}}


def ios_assets():
    native = ROOT / '../../ios/Helm/Images.xcassets/AppIcon.appiconset'
    target = native if native.is_dir() else ROOT / 'appiconset'
    target.mkdir(parents=True, exist_ok=True)
    for mode, filename in [('default', 'AppIcon.png'), ('dark', 'AppIcon-dark.png'), ('tinted', 'AppIcon-tinted.png')]:
        if mode == 'default':
            background = '<rect width="1024" height="1024" fill="url(#bodyMetal)"/><rect width="1024" height="1024" fill="url(#grain)"/>'
        elif mode == 'dark':
            background = '<defs><linearGradient id="darkBody" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#000"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#darkBody)"/>'
        else:
            background = '<rect width="1024" height="1024" fill="#000"/>'
        artwork = deck(dark=mode == 'dark')
        if mode == 'tinted':
            artwork = '<defs><filter id="gray" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter></defs><g filter="url(#gray)">' + artwork + '</g>'
        source = ROOT / 'app-icon' / f'ios-{mode}.svg'
        write(source, svg(1024, 1024, materials() + background + artwork, f'Helm — full-bleed iOS {mode} icon'))
        output = target / filename
        render(source, output, 1024, 1024)
        with Image.open(output) as image:
            opaque = image.convert('RGB')
            if mode == 'tinted':
                opaque = opaque.convert('L').convert('RGB')
            opaque.save(output)
    write(target / 'Contents.json', json.dumps(CONTENTS, separators=(',', ':')))
    return target


def load(path):
    with Image.open(path) as image:
        return image.convert('RGBA')


def panels():
    result = [(ROOT / 'app-icon.png', 40, 160, 1)]
    for size, x in [(180,1120), (80,1340), (40,1470), (16,1580)]:
        result.append((ROOT / 'app-icon' / f'icon-{size}.png', x, 160 + (1024-size)//2, 1))
    result += [(ROOT / 'app-icon/icon-16.png', 40, 2360, 8), (ROOT / 'app-icon/icon-40.png', 250, 2360, 8)]
    return result


def sheet(target):
    image = Image.new('RGB', (HALF*2, SHEET_HEIGHT), '#1e1e1e')
    draw = ImageDraw.Draw(image)
    draw.rectangle((HALF,0,HALF*2-1,SHEET_HEIGHT-1), fill='#f5f5f7')
    for index, (mode, foreground, quiet) in enumerate([('dark','#e8e8ea','#99999d'), ('light','#151517','#707075')]):
        origin = index*HALF
        def label(x,y,text,size=14,bright=False):
            draw.text((origin+x,y), text, font=ImageFont.truetype(str(FONT),size), fill=foreground if bright else quiet)
        def paste(asset,x,y):
            image.paste(asset, (origin+x,y), asset)
        label(40,32,'HELM',28,True)
        label(40,78,f'{mode.upper()} · machined caps / concentric silver dial / native pixels',16)
        label(40,128,'2 × 2 DECK · 258px cells / 44px gaps / continuous-curvature caps',18,True)
        label(480,1200,'1024 px')
        for size,x in [(180,1120), (80,1340), (40,1470), (16,1580)]:
            label(x,786,f'{size} px' + (' · hint' if size == 16 else ''),12)
        label(1130,914,'32 px · off-centre slot',12)
        paste(load(ROOT / 'app-icon/icon-32.png'),1130,866)
        for path,x,y,zoom in panels():
            asset=load(path)
            if zoom != 1:
                asset=asset.resize((asset.width*zoom,asset.height*zoom),Image.Resampling.NEAREST)
            paste(asset,x,y)
        label(40,1240,'WORDMARK · outlined Inter Display Regular / Hush metrics / 6.8% dial-notch knockout',16,True)
        paste(load(ROOT / f'wordmark-{mode}.png'),40,1280)
        label(40,1690,f'STANDALONE MARK · transparent on {"black" if index == 0 else "white"} / silver key edges',16,True)
        draw.rectangle((origin+40,1730,origin+591,2281),fill='#000' if index == 0 else '#fff')
        paste(load(ROOT / 'logo-mark.png').resize((512,512),Image.Resampling.LANCZOS),60,1750)
        label(690,1740,'iOS · opaque squares / system applies corners',16,True)
        for column,(name,description) in enumerate([('AppIcon.png','default'),('AppIcon-dark.png','black body / darker caps'),('AppIcon-tinted.png','tinted / pure grayscale')]):
            x=690+column*300
            paste(load(target/name).resize((180,180),Image.Resampling.LANCZOS),x,1800)
            label(x,2000,description)
        label(40,2320,'PIXEL INSPECTION · 8x nearest-neighbour',16,True)
        label(40,2504,'16 px × 8 · solid dial')
        label(250,2700,'40 px × 8 · master reduction')
        label(40,2770,'16 / 32: flat hand hints · no drop shadows or glows · transparent standalone slot',12)
    image.save(ROOT / 'contact-sheet.png')


def verify(target):
    expected = {'logo-mark.png': (1024, 1024), 'splash-mark.png': (512, 512), 'app-icon.png': (1024, 1024)}
    for mode in ('dark', 'light'):
        root = ET.parse(ROOT / f'wordmark-{mode}.svg').getroot()
        expected[f'wordmark-{mode}.png'] = (int(root.attrib['width']) * 2, 384)

    for size in (16, 32, 40, 80, 180):
        expected[f'app-icon/icon-{size}.png'] = (size, size)
    for filename, size in expected.items():
        with Image.open(ROOT / filename) as image:
            assert image.size == size, filename
            assert image.mode == 'RGBA' and image.getchannel('A').getextrema() == (0, 255), filename
            assert image.getpixel((0, 0))[3] == 0, filename
            if filename.startswith('wordmark-'):
                assert image.getpixel((206,229))[3] == 0, 'Outlined lockup slot must be fully transparent'
    with Image.open(ROOT / 'app-icon/icon-16.png') as image:
        assert image.getpixel((3,3)) == (106,106,110,255)
        assert image.getpixel((7,3)) == (21,21,23,255)
        assert image.getpixel((9,9)) == (216,216,218,255)
        assert image.getpixel((10,10)) == (216,216,218,255)
    with Image.open(ROOT / 'app-icon/icon-32.png') as image:
        assert image.getpixel((21,21)) == (216,216,218,255)
        assert max(image.getpixel((19,19))[:3]) < 180
    with Image.open(ROOT / 'logo-mark.png') as image:
        assert image.getpixel((593,593))[3] == 0, 'Standalone notch must be transparent'
    with Image.open(ROOT / 'splash-mark.png') as image:
        assert image.getpixel((296,296))[3] == 0, 'Splash notch must be transparent'
    for filename in ('AppIcon.png', 'AppIcon-dark.png', 'AppIcon-tinted.png'):
        with Image.open(target / filename) as image:
            assert image.size == (1024, 1024) and image.mode == 'RGB', filename
            if filename == 'AppIcon-tinted.png':
                red, green, blue = image.split()
                assert red.tobytes() == green.tobytes() == blue.tobytes()
                assert image.getpixel((0, 0)) == (0, 0, 0)
                assert max(image.crop((534, 534, 792, 792)).convert('L').getextrema()) > max(image.crop((232, 232, 490, 490)).convert('L').getextrema())
            else:
                assert max(image.getpixel((0, 0))) < 50
            if filename == 'AppIcon-dark.png':
                assert image.getpixel((0,0)) == (0,0,0)
                assert image.getpixel((0,1023)) == (10,10,10)
    with Image.open(target / 'AppIcon.png') as normal, Image.open(target / 'AppIcon-dark.png') as dark:
        assert dark.getpixel((100,100))[0] < normal.getpixel((100,100))[0] - 20
        assert dark.getpixel((350,350))[0] < normal.getpixel((350,350))[0]
        assert dark.crop((590,590,736,736)).tobytes() == normal.crop((590,590,736,736)).tobytes(), 'Dark dial must be unchanged'
    assert (target / 'Contents.json').read_text().strip() == json.dumps(CONTENTS, separators=(',', ':'))
    for source in ROOT.rglob('*.svg'):
        content = source.read_text()
        assert '<metadata' not in content and '<text' not in content and 'feDropShadow' not in content
        for element in ET.parse(source).iter():
            for attribute, value in element.attrib.items():
                if attribute.endswith('href'):
                    assert value.startswith('#'), 'SVG references must be local fragments'
    with Image.open(ROOT / 'contact-sheet.png') as image:
        assert image.size == (HALF * 2, SHEET_HEIGHT) and image.mode == 'RGB'
        for origin, background in [(0, '#1e1e1e'), (HALF, '#f5f5f7')]:
            for path, x, y, zoom in panels():
                asset = load(path)
                asset = asset.resize((asset.width * zoom, asset.height * zoom), Image.Resampling.NEAREST)
                composite = Image.new('RGB', asset.size, background)
                composite.paste(asset, (0, 0), asset)
                assert image.crop((origin + x, y, origin + x + asset.width, y + asset.height)).tobytes() == composite.tobytes(), (path, origin)
            asset = load(ROOT / 'logo-mark.png').resize((512, 512), Image.Resampling.LANCZOS)
            composite = Image.new('RGB', asset.size, '#000' if origin == 0 else '#fff')
            composite.paste(asset, (0, 0), asset)
            assert image.crop((origin + 60, 1750, origin + 572, 2262)).tobytes() == composite.tobytes()
    assert not (ROOT / 'candidates').exists()
    print('Verified PNG sizes/alpha, transparent notch, solid 16px dial, off-centre 32px slot, distinct black iOS variant with unchanged dial, grayscale tint/brightest dial, exact JSON, outlined SVGs and contact-sheet panels.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--marks-only', action='store_true', help='produce priority standalone files only')
    args = parser.parse_args()
    priority_assets()
    if args.marks_only:
        return
    master_icon()
    small_icons()
    wordmarks()
    target = ios_assets()
    sheet(target)
    verify(target)


if __name__ == '__main__':
    main()
