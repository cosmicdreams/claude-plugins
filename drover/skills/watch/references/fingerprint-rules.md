---
name: fingerprint-rules
description: >
  Fingerprinting rules for drover error deduplication. Defines per-source normalization
  and SHA-1 hash computation for watchdog, PHP error log, Nginx, and Apache sources.
  Referenced by drover:watch and drover:triage.
---

# Drover Fingerprint Rules

Fingerprints are the canonical deduplication key for drover tickets. Each error source
uses source-specific normalization before hashing to group semantically identical errors
regardless of variable data (IDs, timestamps, IP addresses, file paths).

## Normalization Rules (apply to all sources)

Before computing any fingerprint, apply these transformations to the message string:

1. **Strip 4+ digit integers** — removes node IDs, WIDs, timestamps embedded in messages
   - Pattern: `\b\d{4,}\b` → `{N}`
2. **Strip UUIDs** — removes entity UUIDs
   - Pattern: `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` → `{UUID}`
3. **Strip URLs** — removes request-specific URLs
   - Pattern: `https?://[^\s"']+` → `{URL}`
4. **Strip IP addresses** — removes client IPs, server addresses
   - Pattern: `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b` → `{IP}`
5. **Strip absolute paths** — removes environment-specific file paths
   - Pattern: `/[a-zA-Z0-9_/.-]{10,}` → `{PATH}` (only paths with 10+ chars to avoid false positives)
6. **Normalize whitespace** — collapse multiple spaces/newlines to single space, strip leading/trailing whitespace
7. **Truncate** — trim to 120 characters

## Per-Source Fingerprint Keys

### Watchdog (Drupal `watchdog` table)

**Input fields:** `type`, `message`, `variables` (JSON-decoded message variables substituted in)

**Composite key format:** `watchdog:{type}:{normalized_message[:120]}`

**Steps:**
1. Substitute `variables` JSON into `message` placeholders (e.g. `%var` → value from variables)
2. Apply normalization rules above
3. Compute SHA-1 of composite key → take first 12 hex characters

**Example:**
```
type: "php"
message: "PDOException: SQLSTATE[HY000]: General error: 1 Can't create/write to file '/tmp/mysql.tmp' (Errcode: 28 \"No space left on device\") in /var/www/html/modules/custom/my_module/src/MyService.php on line 142"
→ normalized: "PDOException: SQLSTATE[HY000]: General error: {N} Can't create/write to file {PATH} (Errcode: {N} \"No space left on device\") in {PATH} on line {N}"
→ key: "watchdog:php:PDOException: SQLSTATE[HY000]: General error: {N} Can't create/write to"
→ fp: sha1(key)[:12] = "a3f2b1c4d5e6"
```

### PHP Error Log

**Input fields:** `level`, `message`, `file` (make module-relative by stripping everything before `modules/` or `core/`)

**Composite key format:** `php:{level}:{normalized_message[:120]}:{module_relative_file}`

**Additional normalization:**
- Convert `$module_relative_file`: strip absolute prefix up to `modules/` or `core/`, keep remainder
  - Example: `/var/www/html/modules/custom/my_module/src/MyService.php:142` → `modules/custom/my_module/src/MyService.php` (strip line number)
- Strip line numbers from file references in the message itself

**Example:**
```
level: "PHP Fatal error"
message: "Uncaught Error: Call to undefined method Drupal\my_module\MyService::loadItems() in /var/www/html/modules/custom/my_module/src/MyService.php:98"
file: "/var/www/html/modules/custom/my_module/src/MyService.php"
→ module_relative_file: "modules/custom/my_module/src/MyService.php"
→ normalized message: "Uncaught Error: Call to undefined method Drupal\my_module\MyService::loadItems() in {PATH}"
→ key: "php:PHP Fatal error:Uncaught Error: Call to undefined method Drupal\my_module\MyService::loadItems():modules/custom/my_module/src/MyService.php"
→ fp: sha1(key)[:12]
```

### Nginx Error Log

**Input fields:** `level`, `message`

**Composite key format:** `nginx:{level}:{normalized_message[:120]}`

**Additional normalization (beyond standard):**
- Strip client IP from messages: `client: {IP}` → removed
- Strip PID references: `\[pid \d+\]` → removed
- Strip request IDs (e.g. X-Request-ID): `request_id "[a-z0-9]+"` → removed
- Strip upstream addresses: `upstream: "https?://[^\s"]+"` → `upstream: {URL}`

### Apache Error Log

**Input fields:** `level`, `message`

**Composite key format:** `apache:{level}:{normalized_message[:120]}`

**Additional normalization (beyond standard):**
- Strip `[client {IP}:{port}]` prefixes
- Strip `[pid \d+]` markers
- Strip AH error codes from message prefix: `AH\d+: ` → removed (keep remaining message)
- Strip referer lines: `referer: {URL}` → removed

## Fingerprint Lookup

To look up an existing ticket by fingerprint hash `{fp}`:

```bash
bd list -l board-drover --db .beads/drover.db --json | python3 -c "
import json, sys
items = json.load(sys.stdin)
fp = '{fp}'
for item in items:
    body = item.get('body', '')
    if f'\"fp\": \"{fp}\"' in body or f'**Fingerprint:** \`{fp}\`' in body:
        print(json.dumps(item))
        break
"
```

If a match is found: augment the existing ticket (increment count, update last-seen, update context).
If no match: create a new ticket.

## Python Helper (inline in triage agent)

```python
import hashlib, re, json

NORM_PATTERNS = [
    (re.compile(r'\b\d{4,}\b'), '{N}'),
    (re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I), '{UUID}'),
    (re.compile(r'https?://[^\s"\']+'), '{URL}'),
    (re.compile(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b'), '{IP}'),
    (re.compile(r'/[a-zA-Z0-9_/.-]{10,}'), '{PATH}'),
]

def normalize(msg):
    for pattern, replacement in NORM_PATTERNS:
        msg = pattern.sub(replacement, msg)
    msg = re.sub(r'\s+', ' ', msg).strip()
    return msg[:120]

def fingerprint_watchdog(type_, message):
    key = f"watchdog:{type_}:{normalize(message)}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]

def fingerprint_php(level, message, filepath):
    rel = re.sub(r'^.*?(modules/|core/)', r'\1', filepath)
    rel = re.sub(r':\d+$', '', rel)
    key = f"php:{level}:{normalize(message)}:{rel}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]

def fingerprint_nginx(level, message):
    msg = re.sub(r'client: \S+', '', message)
    msg = re.sub(r'\[pid \d+\]', '', msg)
    msg = re.sub(r'request_id "[a-z0-9]+"', '', msg)
    key = f"nginx:{level}:{normalize(msg)}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]

def fingerprint_apache(level, message):
    msg = re.sub(r'\[client [^\]]+\]', '', message)
    msg = re.sub(r'\[pid \d+\]', '', msg)
    msg = re.sub(r'AH\d+: ', '', msg)
    key = f"apache:{level}:{normalize(msg)}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]
```
