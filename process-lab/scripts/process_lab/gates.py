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
        self.macro = []
        self.parameter = None
        self.ignore_body = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            if self.table is None:
                self.table = []
                self.depth = 1
            else:
                self.depth += 1
                if self.cell is not None:
                    self.cell["parts"].append("; ")
            return
        if self.table is None:
            return
        if tag == "ac:structured-macro":
            self.macro.append({"status": attrs.get("ac:name") == "status", "title": "", "body": False})
            if attrs.get("ac:name") != "status" and self.cell is not None:
                self.unsupported.add(attrs.get("ac:name") or "unnamed")
        elif tag == "ac:parameter" and self.macro:
            self.parameter = attrs.get("ac:name")
        elif tag in ("ac:plain-text-body", "ac:rich-text-body") and self.macro:
            self.macro[-1]["body"] = True
        if self.depth == 1:
            if tag == "tr":
                self.row = []
            elif tag in ("td", "th") and self.row is not None:
                self.cell = {"kind": tag, "parts": [], "colspan": attrs.get("colspan", "1"), "rowspan": attrs.get("rowspan")}
        if self.cell is not None and tag in ("p", "li", "br", "div", "td"):
            self.cell["parts"].append("\n" if self.depth == 1 else "; ")

    def handle_endtag(self, tag):
        if tag == "table" and self.table is not None:
            self.depth -= 1
            if self.depth == 0:
                self.tables.append(self.table)
                self.table = None
            return
        if tag == "ac:parameter":
            self.parameter = None
        elif tag in ("ac:plain-text-body", "ac:rich-text-body") and self.macro:
            self.macro[-1]["body"] = False
        elif tag == "ac:structured-macro" and self.macro:
            macro = self.macro.pop()
            if macro["status"] and self.cell is not None:
                self.cell["parts"].append(macro["title"])
        if self.table is not None and self.depth == 1:
            if tag in ("td", "th") and self.cell is not None:
                self.row.append(self.cell)
                self.cell = None
            elif tag == "tr" and self.row is not None:
                self.table.append(self.row)
                self.row = None

    def handle_data(self, data):
        if self.cell is None:
            return
        if self.macro and self.macro[-1]["status"]:
            if self.parameter == "title":
                self.macro[-1]["title"] += data
        elif not self.macro or (self.macro[-1]["body"] and self.parameter is None):
            self.cell["parts"].append(data)

def clean(value):
    return re.sub(r"\s+", " ", value).strip()


def _cell_text(cell):
    return "".join(cell["parts"])


def _identifier(value):
    match = re.search(r"\s*\{([^{}]*)\}\s*$", value)
    if match:
        return value[:match.start()].strip(), match.group(1).strip()
    return value.strip(), slug(value)


def _expand(row, number):
    expanded = []
    for cell in row:
        if cell["rowspan"] is not None:
            raise ValueError("row " + str(number) + ": rowspan is unsupported")
        try:
            span = int(cell["colspan"])
        except ValueError as exc:
            raise ValueError("row " + str(number) + ": invalid colspan") from exc
        if span < 1:
            raise ValueError("row " + str(number) + ": invalid colspan")
        expanded.extend([_cell_text(cell)] * span)
    return expanded


def parse_page(html):
    parser = TableParser()
    parser.unsupported = set()
    parser.feed(html)
    matches = []
    for table in parser.tables:
        for index, row in enumerate(table):
            names = [clean(value).lower() for value in _expand(row, index + 1)]
            if all(name in names for name in HEADERS):
                matches.append((table, index, {name: names.index(name) for name in HEADERS}))
                break
    if len(matches) != 1:
        raise ValueError("expected exactly one gate table")
    table, header_index, columns = matches[0]
    width = len(_expand(table[header_index], header_index + 1))
    gates, warnings, gate_ids = [], [], set()
    for number, row in enumerate(table[header_index + 1:], header_index + 2):
        if not row:
            continue
        values = _expand(row, number)
        if len(values) != width:
            raise ValueError("row " + str(number) + ": cell count differs from header")
        def column(name):
            return values[columns[name]]
        label, gate_id = _identifier(clean(column("gate")))
        if not gate_id or gate_id in gate_ids:
            raise ValueError("row " + str(number) + ": empty or duplicate gate id: " + gate_id)
        gate_ids.add(gate_id)
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
        obligation_ids = {item["id"] for item in obligations}
        for part in re.split(r"[;\n]+", column("obligations")):
            item, identifier = _identifier(clean(part))
            if item:
                if not identifier or identifier in obligation_ids:
                    raise ValueError("row " + str(number) + ": empty or duplicate obligation id: " + identifier)
                obligation_ids.add(identifier)
                obligations.append({"id": identifier, "text": item})
        if not obligations:
            warnings.append("Gate " + label + " has no obligations; check the row for content the parser cannot read")
        gates.append({"id": gate_id, "label": label, "detected_by": detected, "jira_transition": transition, "obligations": obligations})
    for name in sorted(parser.unsupported):
        warnings.append("Macro '" + name + "' in the gate table contributes only its plain text; include or excerpt content is not read")
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


def load_cache(repo, page_id=None):
    path = cache_path(repo)
    if not path.exists():
        return None
    cache = json.loads(path.read_text(encoding="utf-8"))
    return cache if page_id is None or cache.get("page_id") == page_id else None
