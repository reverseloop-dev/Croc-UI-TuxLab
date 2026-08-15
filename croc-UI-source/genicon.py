#!/usr/bin/env python3
"""Generate 256x256 PNG icon for CroC UI"""
import struct, zlib, sys

def create_png(w, h, get_pixel):
    """get_pixel(x, y) -> (r, g, b)"""
    sig = b'\x89PNG\r\n\x1a\n'
    
    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data)
    ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + struct.pack('>I', ihdr_crc)
    
    # Image data
    raw = b''
    for y in range(h):
        raw += b'\x00'  # filter None
        for x in range(w):
            raw += bytes(get_pixel(x, y))
    
    compressed = zlib.compress(raw)
    idat_crc = zlib.crc32(b'IDAT' + compressed)
    idat = struct.pack('>I', len(compressed)) + b'IDAT' + compressed + struct.pack('>I', idat_crc)
    
    # IEND
    iend_crc = zlib.crc32(b'IEND')
    iend = struct.pack('>I', 0) + b'IEND' + struct.pack('>I', iend_crc)
    
    return sig + ihdr + idat + iend

accent = (0, 163, 255)
dark = (7, 7, 13)
lite = tuple(min(a+60, 255) for a in accent)
glow = tuple(min(a+100, 255) for a in accent)

w, h = 256, 256
cx, cy = w // 2, h // 2

def pixel(x, y):
    dx, dy = x - cx, y - cy
    dist = (dx*dx + dy*dy) ** 0.5
    r = min(w, h) // 2 - 16
    
    if dist < r:
        # Cross shape
        horz = abs(dy) < 10 and abs(dx) < r * 0.55
        vert = abs(dx) < 10 and abs(dy) < r * 0.55
        if horz or vert:
            return glow if dist < r * 0.4 else accent
        elif dist < r * 0.85:
            return lite
        else:
            border_dist = r - dist
            if border_dist < 6:
                f = border_dist / 6
                return tuple(int(a * f + d * (1-f)) for a, d in zip(accent, lite))
            return accent
    elif dist < r + 8:
        f = (dist - r) / 8
        return tuple(int(a * (1-f) + d * f) for a, d in zip(accent, dark))
    else:
        return dark

png = create_png(w, h, pixel)
out = sys.argv[1] if len(sys.argv) > 1 else '/var/home/hybrid/Documenti/crocUI/assets/icon.png'
with open(out, 'wb') as f:
    f.write(png)
print(f'Wrote {out} ({len(png)} bytes, {w}x{h})')