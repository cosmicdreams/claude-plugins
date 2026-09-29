"""Parse a Confluence storage-format gate table and persist its cache."""
import json
import re
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


DETECTIONS = {"branch-created", "commit", "tests-passed", "pushed", "pull-request-opened", "declared"}
HEADERS = ("gate", "detected by", "jira transition", "obligations")


def slug(value):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", value.lower()))


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.table = None
        self.row = None
        self.cell = None
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            if self.table is None:
                self.table = []
                self.depth = 1
            else:
                self.depth += 1
        elif self.table is not None and self.depth == 1:
            if tag == "tr":
                self.row = []
            elif tag in ("td", "th") and self.row is not None:
                self.cell = {"kind": tag, "parts": []}
            elif self.cell is not None and tag in ("p", "li", "br", "div"):
                self.cell["parts"].append("\n")

    def handle_endtag(self, tag):
        if tag == "table" and self.table is not None:
            self.depth -= 1
            if self.depth == 0:
                self.tables.append(self.table)
                self.table = None
        elif self.table is not None and self.depth == 1:
            if tag in ("td", "th") and self.cell is not None:
                self.row.append((self.cell["kind"], "".join(self.cell["parts"])))
                self.cell = None
            elif tag == "tr" and self.row is not None:
                self.table.append(self.row)
                self.row = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["parts"].append(data)


def clean(value):
    return re.sub(r"\s+", " ", value).strip()


def parse_page(html):
    parser = TableParser()
    parser.feed(html)
    matches = []
    for table in parser.tables:
        for index, row in enumerate(table):
            names = [clean(cell[1]).lower() for cell in row]
            if all(name in names for name in HEADERS):
                matches.append((table, index, {name: names.index(name) for name in HEADERS}))
                break
    if len(matches) != 1:
        raise ValueError("expected exactly one gate table")
    table, header_index, columns = matches[0]
    gates, warnings = [], []
    for row in table[header_index + 1:]:
        if not row:
            continue
        def column(name):
            index = columns[name]
            return row[index][1] if index < len(row) else ""
        label = clean(column("gate"))
        if not label:
            continue
        detected = clean(column("detected by")).lower().split(" ", 1)[0]
        if detected not in DETECTIONS:
            warnings.append("Unknown detection key for " + label + ": " + detected)
            detected = "declared"
        transition_text = clean(column("jira transition"))
        transition = None
        if transition_text and transition_text.lower() != "none":
            parts = re.split(r"\s*(?:->|→)\s*", transition_text, maxsplit=1)
            if len(parts) != 2 or not all(parts):
                warnings.append("Invalid Jira transition for " + label)
            else:
                transition = {"from": parts[0], "to": parts[1]}
        obligations = []
        if transition:
            obligations.append({"id": "jira-transition", "text": "Jira transition: " + transition["from"] + " -> " + transition["to"]})
        for part in re.split(r"[;\n]+", column("obligations")):
            item = clean(part)
            if item:
                obligations.append({"id": slug(item), "text": item})
        gates.append({"id": slug(label), "label": label, "detected_by": detected, "jira_transition": transition, "obligations": obligations})
    return gates, warnings


def cache_path(repo):
    return Path(repo) / ".velir" / "process-cache.json"


def save_cache(repo, page_id, version, gates, warnings):
    payload = {"page_id": page_id, "page_version": version, "synced_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "gates": gates, "warnings": warnings}
    path = cache_path(repo)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=str(path.parent), delete=False) as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2)
        temporary = Path(stream.name)
    temporary.replace(path)
    return payload


def load_cache(repo):
    path = cache_path(repo)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
