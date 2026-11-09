import ast
import json
import tempfile
import unittest
from pathlib import Path

from import_openfoodfacts import convert_product, fetch_all_products, merge_catalog, read_existing_catalog


class ImportOpenFoodFactsTests(unittest.TestCase):
    def test_fetch_all_products_reads_every_reported_page(self):
        calls = []
        pages = {
            1: {"count": 3, "products": [{"code": "1"}, {"code": "2"}]},
            2: {"count": 3, "products": [{"code": "3"}]},
        }

        def get_page(page, page_size):
            calls.append((page, page_size))
            return pages[page]

        self.assertEqual(fetch_all_products(get_page, 2, 0), [
            {"code": "1"}, {"code": "2"}, {"code": "3"},
        ])
        self.assertEqual(calls, [(1, 2), (2, 2)])

    def test_convert_product_keeps_open_food_facts_fields_and_skips_missing_identity(self):
        product = {
            "code": "001234",
            "product_name": "Monster Ultra",
            "countries_tags": ["en:united-states"],
        }
        converted = convert_product(product)
        self.assertEqual(converted["id"], "off-001234")
        self.assertEqual(converted["ean"], "001234")
        self.assertEqual(converted["name"], "Monster Ultra")
        self.assertIn("world.openfoodfacts.org/product/001234", converted["source_url"])
        self.assertEqual(converted["source_license"], "Open Database License (ODbL)")
        self.assertEqual(converted["open_food_facts"], product)
        self.assertIsNone(convert_product({"code": "123"}))

    def test_merge_preserves_curated_fields_and_updates_by_ean(self):
        existing = [{"id": "manual", "ean": "123", "name": "Curated", "category": "Ultra"}]
        imported = [{
            "id": "off-123", "ean": "123", "name": "Open Food Facts",
            "category": "", "flavor": "", "status": "", "region": "",
            "source": "Open Food Facts", "open_food_facts": {"code": "123"},
        }]

        merged = merge_catalog(existing, imported)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["name"], "Open Food Facts")
        self.assertEqual(merged[0]["category"], "Ultra")
        self.assertEqual(merged[0]["id"], "off-123")

    def test_read_existing_catalog_supports_original_python_data_without_executing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monster_database.json"
            path.write_text(
                "import os\nmonster_data = [{'id': 'manual', 'name': 'Monster'}]\nos.remove('important')\n",
                encoding="utf-8",
            )
            self.assertEqual(read_existing_catalog(path), [{"id": "manual", "name": "Monster"}])

    def test_read_existing_catalog_supports_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "monster_database.json"
            path.write_text(json.dumps([{"id": "manual"}]), encoding="utf-8")
            self.assertEqual(read_existing_catalog(path), [{"id": "manual"}])


if __name__ == "__main__":
    unittest.main()
