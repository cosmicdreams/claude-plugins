"""Offline component-order fixtures."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import extract_compositions


class CompositionTests(unittest.TestCase):
    def test_nested_components_and_void_elements(self):
        html = ('<html><head><title>  One &amp; Two </title><meta name="x"></head><body>'
                '<div data-component-id="outer"><img><div data-component-id="inner"></div></div>'
                '<div data-component-id="next"></div><div data-component-id="outer"></div></body></html>')
        self.assertEqual(extract_compositions.parse_page(html),
                         {"title": "One & Two", "components": ["outer", "next", "outer"]})

    def test_page_and_component_order_is_stable(self):
        pages = [("/z", 200, '<title>Z</title><div data-component-id="b"></div>'),
                 ("/a", 200, '<title>A</title><div data-component-id="b"></div><div data-component-id="a"></div>'),
                 ("/x", 500, "")]
        first = extract_compositions.build_compositions(pages)
        second = extract_compositions.build_compositions(pages)
        encoded = lambda value: json.dumps(value, indent=2).encode()
        self.assertEqual(encoded(first), encoded(second))
        self.assertEqual(first["components"], {"a": ["/a"], "b": ["/a", "/z"]})
        self.assertEqual(first["pagesFailed"], ["/x"])


if __name__ == "__main__":
    unittest.main()
