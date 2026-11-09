#!/usr/bin/env python3
"""Importe les produits Monster Energy d'Open Food Facts dans monster_database.json."""

from __future__ import annotations

import argparse
import ast
import json
import math
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "monster_database.json"
API_URL = "https://world.openfoodfacts.org/api/v2/search"
FIELDS = (
    "code,product_name,product_name_en,brands,categories_tags,countries_tags,"
    "quantity,ingredients_text,ingredients_text_en,nutriments,nutriscore_grade,"
    "nova_group,ecoscore_grade,image_url,url,last_modified_t"
)
USER_AGENT = "StockMonsters catalog importer/1.0 (Open Food Facts API client)"
MAX_PRODUCTS = 20_000


def fetch_page(page: int, page_size: int) -> dict:
    query = urlencode({
        "brands_tags": "monster-energy",
        "fields": FIELDS,
        "page": page,
        "page_size": page_size,
    })
    request = Request(f"{API_URL}?{query}", headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload, dict) or not isinstance(payload.get("products"), list):
                raise ValueError("Réponse Open Food Facts invalide : liste de produits absente.")
            return payload
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise RuntimeError(f"Open Food Facts a répondu HTTP {error.code}.") from error
        except URLError as error:
            if attempt == 2:
                raise RuntimeError(f"Connexion à Open Food Facts impossible : {error.reason}.") from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeError("Open Food Facts a renvoyé un JSON illisible.") from error
        time.sleep(2**attempt)
    raise RuntimeError("Impossible de récupérer Open Food Facts.")


def fetch_all_products(
    get_page: Callable[[int, int], dict], page_size: int, delay: float
) -> list[dict]:
    first = get_page(1, page_size)
    total = first.get("count")
    if not isinstance(total, int) or total < 0:
        raise ValueError("La réponse Open Food Facts ne contient pas de compteur valide.")
    if total > MAX_PRODUCTS:
        raise ValueError(f"Le catalogue dépasse la limite de sécurité de {MAX_PRODUCTS} produits.")

    products = list(first["products"])
    pages = math.ceil(total / page_size)
    for page in range(2, pages + 1):
        if delay:
            time.sleep(delay)
        payload = get_page(page, page_size)
        products.extend(payload["products"])

    if len(products) > total:
        products = products[:total]
    return products


def convert_product(product: dict) -> dict | None:
    code = str(product.get("code") or "").strip()
    name = str(product.get("product_name") or product.get("product_name_en") or "").strip()
    if not code or not name:
        return None
    return {
        "id": f"off-{code}",
        "ean": code,
        "name": name,
        "category": "",
        "flavor": "",
        "status": "",
        "region": "",
        "source": "Open Food Facts",
        "source_url": f"https://world.openfoodfacts.org/product/{code}",
        "source_license": "Open Database License (ODbL)",
        "open_food_facts": product,
    }


def read_existing_catalog(path: Path) -> list[dict]:
    if not path.exists():
        return []
    content = path.read_text(encoding="utf-8")
    try:
        catalog = json.loads(content)
    except json.JSONDecodeError:
        tree = ast.parse(content, filename=str(path))
        catalog = None
        for statement in tree.body:
            if isinstance(statement, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "monster_data"
                for target in statement.targets
            ):
                catalog = ast.literal_eval(statement.value)
                break
        if catalog is None:
            raise ValueError(f"{path} n'est ni un JSON valide ni l'ancien catalogue Python.")
    if not isinstance(catalog, list) or not all(isinstance(item, dict) for item in catalog):
        raise ValueError(f"Le catalogue existant dans {path} doit être une liste d'objets.")
    return catalog


def merge_catalog(existing: list[dict], imported: list[dict]) -> list[dict]:
    merged = list(existing)
    index_by_ean = {
        str(item["ean"]): index
        for index, item in enumerate(merged)
        if item.get("ean")
    }
    for item in imported:
        ean = item["ean"]
        if ean not in index_by_ean:
            index_by_ean[ean] = len(merged)
            merged.append(item)
            continue

        index = index_by_ean[ean]
        previous = merged[index]
        updated = {**previous, **item}
        for field in ("category", "flavor", "status", "region"):
            if previous.get(field):
                updated[field] = previous[field]
        merged[index] = updated
    return merged


def write_catalog(path: Path, catalog: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, delete=False
        ) as temporary:
            temporary_path = temporary.name
            json.dump(catalog, temporary, ensure_ascii=False, indent=2)
            temporary.write("\n")
        os.replace(temporary_path, path)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.unlink(temporary_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Fichier JSON à mettre à jour.")
    parser.add_argument("--page-size", type=int, default=100, help="Nombre de produits par requête (1-100).")
    parser.add_argument("--delay", type=float, default=1.0, help="Pause entre les pages, en secondes.")
    args = parser.parse_args()
    if not 1 <= args.page_size <= 100:
        parser.error("--page-size doit être compris entre 1 et 100.")
    if args.delay < 0:
        parser.error("--delay ne peut pas être négatif.")

    original = read_existing_catalog(args.output)
    raw_products = fetch_all_products(fetch_page, args.page_size, args.delay)
    imported = [item for product in raw_products if (item := convert_product(product))]
    if not imported:
        raise RuntimeError("Aucun produit Monster Energy exploitable reçu; fichier inchangé.")

    catalog = merge_catalog(original, imported)
    write_catalog(args.output, catalog)
    print(
        f"{len(imported)} produit(s) importé(s), {len(catalog)} entrée(s) au total "
        f"dans {args.output} ({datetime.now(timezone.utc).date().isoformat()})."
    )


if __name__ == "__main__":
    main()
