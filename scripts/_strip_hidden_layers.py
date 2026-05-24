#!/usr/bin/env python3
"""Strip Inkscape layers marked display:none from an SVG.

Used by process_logo to drop reference layers (typically holding large
embedded base64 PNGs) before the SVG is handed off to Inkscape + svgo.
"""

import sys
import xml.etree.ElementTree as ET

SVG = "http://www.w3.org/2000/svg"
INK = "http://www.inkscape.org/namespaces/inkscape"
SODIPODI = "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
XLINK = "http://www.w3.org/1999/xlink"

for prefix, uri in [
    ("", SVG),
    ("inkscape", INK),
    ("sodipodi", SODIPODI),
    ("xlink", XLINK),
]:
    ET.register_namespace(prefix, uri)


def is_hidden_layer(el):
    return (
        el.tag == f"{{{SVG}}}g"
        and el.get(f"{{{INK}}}groupmode") == "layer"
        and "display:none" in (el.get("style") or "")
    )


def strip(parent):
    for child in list(parent):
        if is_hidden_layer(child):
            parent.remove(child)
        else:
            strip(child)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    tree = ET.parse(src)
    strip(tree.getroot())
    tree.write(dst, xml_declaration=True, encoding="utf-8")


if __name__ == "__main__":
    main()