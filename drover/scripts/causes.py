"""Pattern-based cause diagnosis for Drupal/Acquia application errors.

Given a fingerprint group's summary + sample lines, return a likely
cause + suggested fix. The pattern library covers the most common
Drupal-on-Acquia error shapes; anything that doesn't match returns
an honest "undiagnosed" verdict instead of fabricated speculation.

Add to the library here when a recurring issue surfaces in a
real-world report. Each entry should be supported by a real log line
in the doc-comment so future maintainers can verify the regex still
matches when Drupal's error text drifts between major versions.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class Cause:
    """A diagnosed (or undiagnosed) cause. Always honest about confidence."""

    title: str               # one-line headline ("Missing entity_embed display")
    explanation: str         # 1-3 sentences on what produces this error
    suggested_fix: str       # 1-2 sentences on first-step remediation
    confidence: str          # 'high' | 'medium' | 'low'
    pattern_id: str | None   # which library entry fired, or None

    def to_markdown(self) -> str:
        """Inline markdown block suitable for embedding under a top-issue."""
        return (
            f"- **Likely cause:** {self.title}  \n"
            f"  {self.explanation}\n"
            f"- **Suggested fix:** {self.suggested_fix}  \n"
            f"  _Confidence: {self.confidence}_"
        )


# --- Pattern library ------------------------------------------------------
#
# Each entry has:
#   id         stable token for tracking which pattern fired
#   match      list of regexes (any-of); searched against
#              (summary + first-sample), case-insensitive
#   channel    optional Drupal watchdog channel constraint
#   title      short headline shown to the user
#   explanation
#   suggested_fix
#   confidence 'high' (canonical match) | 'medium' (likely match)
#              | 'low' (best-effort)
#
# Order matters when patterns might overlap — list more specific
# patterns first.

PATTERNS: list[dict] = [
    {
        "id": "drupal-entity-embed-missing-display",
        "channel": "entity_embed",
        "match": [
            r"invalid display settings encountered",
            r"could not process following settings for entity type",
        ],
        "title": "Missing or renamed entity_embed display mode",
        "explanation": (
            "Drupal's entity_embed module emits this when content "
            "references a view-mode/display that no longer exists or "
            "has been renamed. Each occurrence is one broken embed "
            "token in the rendered output — users see a blank slot or "
            "fallback content where a media item should appear."
        ),
        "suggested_fix": (
            "The UUID in the message names the affected media item. "
            "Either restore the missing display in the media type's "
            "Manage Display tab, or run a migration to update affected "
            "nodes/blocks to reference an existing display."
        ),
        "confidence": "high",
    },
    {
        "id": "drupal-database-syntax-error",
        "match": [
            r"sqlstate\[42000\].*syntax error",
            r"databaseexceptionwrapper.*syntax error",
        ],
        "title": "Malformed SQL query reaching MySQL",
        "explanation": (
            "Drupal's database layer received a query MySQL refused as "
            "syntactically invalid. Almost always caused by a contrib "
            "or custom module concatenating user input or empty values "
            "into a query without proper placeholder/escaping, or a "
            "code path that builds a query when one of its inputs is "
            "missing."
        ),
        "suggested_fix": (
            "Use the request_id in the message to find the offending "
            "request, then enable database query logging to capture the "
            "exact query. The fix is almost always replacing the bad "
            "interpolation with `db_select`/`->condition()` placeholders."
        ),
        "confidence": "high",
    },
    {
        "id": "drupal-database-missing-table",
        "match": [
            r"sqlstate\[42s02\]",
            r"base table or view not found",
        ],
        "title": "Missing database table",
        "explanation": (
            "A query references a table that doesn't exist in the "
            "current database. Common after a partial database "
            "migration, a missed `drush updatedb`, or an env where a "
            "module was disabled but its tables were never created."
        ),
        "suggested_fix": (
            "Run `drush updatedb` (and `drush cim` if config-managed). "
            "If the table belongs to a module that's enabled, "
            "uninstalling and reinstalling the module will recreate it."
        ),
        "confidence": "high",
    },
    {
        "id": "drupal-database-connection-refused",
        "match": [
            r"sqlstate\[hy000\].*connection refused",
            r"sqlstate\[hy000\].*server has gone away",
            r"sqlstate\[08\d\d\]",  # connection-related SQLSTATE class
        ],
        "title": "Database connection failure",
        "explanation": (
            "Drupal couldn't talk to MySQL. Either the database server "
            "was unreachable (network, restart, max_connections hit) "
            "or a long-running connection was reaped mid-query."
        ),
        "suggested_fix": (
            "Check Acquia's database health metrics and `max_connections`. "
            "For 'server has gone away' specifically, the bad path is "
            "usually a long-running PHP process holding a connection "
            "past `wait_timeout` — either shorten the work or add "
            "PDO::ATTR_PERSISTENT=false."
        ),
        "confidence": "high",
    },
    {
        "id": "acquia-solr-flood-protection",
        "match": [
            r"flood protection has blocked this solr request",
            r"acquia search flood",
        ],
        "title": "Acquia Search rate limit hit",
        "explanation": (
            "Acquia's hosted Solr has a per-minute query quota. When "
            "exceeded, requests get a 429 with a flood-protection "
            "body. The site's search results page degrades or fails."
        ),
        "suggested_fix": (
            "Add a results cache for repeated queries (search_api has "
            "this built in via processors). For genuine traffic spikes "
            "or large facet operations, file an Acquia support ticket "
            "to raise the quota — they'll typically grant it for free."
        ),
        "confidence": "high",
    },
    {
        "id": "drupal-login-attempt-failed",
        "channel": "user",
        "match": [
            r"login attempt failed from",
        ],
        "title": "Failed login attempts (potential credential stuffing)",
        "explanation": (
            "Drupal logs every failed authentication. When the same IP "
            "or small set of IPs accounts for hundreds of attempts in "
            "a month, this is almost always automated credential "
            "stuffing rather than user mistakes."
        ),
        "suggested_fix": (
            "Enable Drupal's Flood control (already on by default) and "
            "consider reducing the threshold. For specific repeat IPs, "
            "ban via Acquia's IP blocking or the Drupal Ban module. "
            "Consider rolling out 2FA for privileged accounts."
        ),
        "confidence": "high",
    },
    {
        "id": "drupal-access-denied",
        "channel": "access denied",
        "match": [
            r"access denied",
            r"cacheableaccessdeniedhttpexception",
        ],
        "title": "Access-denied responses (HTTP 403)",
        "explanation": (
            "A request hit a route the user wasn't authorized for. "
            "Concentrated on `/admin*` or sensitive paths from a "
            "single IP, this often signals reconnaissance. Spread "
            "across many paths and users, it usually points to a "
            "permission/role configuration drift."
        ),
        "suggested_fix": (
            "Look at the Path: line. Admin paths from external IPs → "
            "ban or rate-limit. Public paths → check whether a recent "
            "permission change accidentally removed access for an "
            "expected role."
        ),
        "confidence": "high",
    },
    {
        "id": "drupal-cron-rerun-attempt",
        "channel": "simple_cron",
        "match": [
            r"attempting to re-run.*cron.*while.*already running",
        ],
        "title": "Cron lock contention",
        "explanation": (
            "Drupal's cron tried to start a job that was already in "
            "flight. Modules with long-running cron tasks (search "
            "reindex, sitemap generation, file replace) hold the "
            "cron lock; subsequent cron triggers from Acquia's "
            "scheduler bounce off."
        ),
        "suggested_fix": (
            "Identify which module's cron task is slow (the message "
            "names it). Either move it to a queue worker, raise the "
            "Acquia cron interval, or stagger the heavy job to a "
            "less-frequent schedule."
        ),
        "confidence": "high",
    },
    {
        "id": "php-memory-exhausted",
        "match": [
            r"allowed memory size of \d+ bytes exhausted",
        ],
        "title": "PHP memory limit exceeded",
        "explanation": (
            "A PHP process consumed all of its `memory_limit` budget "
            "and was killed. Common causes: loading a large dataset "
            "into an array, recursive loops without bounds, or "
            "unbounded entity loads in cron tasks."
        ),
        "suggested_fix": (
            "Find the file:line in the message. If it's a one-off "
            "import/migration, raise `memory_limit` for that command "
            "only. If it's per-request, refactor to chunk the work "
            "(EntityQuery::accessCheck(FALSE)->range(0, N) over a "
            "queue worker)."
        ),
        "confidence": "high",
    },
    {
        "id": "php-timeout-exceeded",
        "match": [
            r"maximum execution time of \d+ seconds (was )?exceeded",
        ],
        "title": "PHP execution timeout",
        "explanation": (
            "A PHP request exceeded `max_execution_time` (typically 30s "
            "on Acquia). The user sees a partial page or a 504; the "
            "request is killed mid-flight."
        ),
        "suggested_fix": (
            "Look at the file:line. If it's a heavy report or admin "
            "screen, move it to a batch process or queue. For external "
            "API calls, add explicit timeouts and circuit-breaking."
        ),
        "confidence": "high",
    },
    {
        "id": "drupal-twig-error",
        "match": [
            r"twig.*error",
            r"twig_error",
        ],
        "title": "Twig template error",
        "explanation": (
            "A Twig template failed to compile or render. Often caused "
            "by a recent theme change that referenced a variable the "
            "current entity doesn't expose, or a syntax error after a "
            "merge."
        ),
        "suggested_fix": (
            "The error names the template path. Compare against the "
            "last theme commit that touched it; common fixes are "
            "guarding `{{ var.field }}` with `{% if var.field is "
            "defined %}` or fixing a typo in a filter."
        ),
        "confidence": "medium",
    },
    {
        "id": "drupal-route-not-found",
        "match": [
            r"routenotfoundexception",
            r"no route found for",
        ],
        "title": "Missing or removed route",
        "explanation": (
            "Code or content referenced a route that doesn't exist in "
            "the current routing table. Often a leftover after a "
            "module was uninstalled, or a hardcoded `Url::fromRoute()` "
            "call that wasn't updated when the route was renamed."
        ),
        "suggested_fix": (
            "Grep the codebase for the route name; either restore the "
            "route by re-enabling its module, update callers to the "
            "new name, or replace with `Url::fromUri('internal:/...')`."
        ),
        "confidence": "high",
    },
    {
        "id": "drupal-cache-backend-unavailable",
        "match": [
            r"cache backend.*was unavailable",
            r"cache backend refused",
        ],
        "title": "Cache backend unreachable",
        "explanation": (
            "Drupal's cache layer couldn't talk to its backend store "
            "(usually Memcache on Acquia). Pages may render but "
            "everything is uncached, so each request is slower and "
            "the database is under more load."
        ),
        "suggested_fix": (
            "Check Acquia's Memcache health. If transient, this clears "
            "itself. If persistent, check the env's Memcache config "
            "and consider raising the connection limit."
        ),
        "confidence": "high",
    },
    {
        "id": "php-fatal-uncaught-exception",
        "match": [
            r"php fatal error.*uncaught",
            r"^fatal error.*uncaught",
        ],
        "title": "Uncaught PHP exception",
        "explanation": (
            "Code threw an exception that no caller handled. The "
            "request died with HTTP 500. The exception class + file "
            "name in the message identifies where to look first."
        ),
        "suggested_fix": (
            "Add a try/catch at the appropriate boundary (controller, "
            "service, queue worker). The fix depends on which exception "
            "type it is — read the file:line and the surrounding code."
        ),
        "confidence": "medium",
    },
    {
        "id": "drupal-config-validation",
        "match": [
            r"config.*does not exist",
            r"configuration.*'.*' does not exist",
        ],
        "title": "Missing configuration object",
        "explanation": (
            "Code asked for a configuration object that's not in the "
            "active store. Usually after a `drush cim` that didn't "
            "complete, or a module that depends on config its install "
            "hook didn't create."
        ),
        "suggested_fix": (
            "Run `drush cim` to import config. If the object is "
            "module-owned, uninstall and reinstall the module so its "
            "install hook fires."
        ),
        "confidence": "medium",
    },
    {
        "id": "apache-child-process-died",
        "match": [
            r"child process \d+ still did not exit",
            r"child process \d+ exited with status",
        ],
        "title": "Apache worker process died",
        "explanation": (
            "An Apache child process was killed unexpectedly. Often a "
            "PHP segfault inside a request, or the process being OOM-"
            "killed by the OS."
        ),
        "suggested_fix": (
            "Check Acquia's process monitoring around the timestamp. "
            "If it correlates with a single request type, that request "
            "needs profiling for memory and segfault triggers."
        ),
        "confidence": "medium",
    },
]


def diagnose(group: dict) -> Cause:
    """Return the best-matching Cause for a fingerprint group, or an
    'undiagnosed' fallback when nothing matches."""
    text_parts: list[str] = []
    if group.get("summary"):
        text_parts.append(str(group["summary"]))
    samples = group.get("samples") or []
    if samples:
        text_parts.append(str(samples[0]))
    text = " ".join(text_parts).lower()

    channel = (group.get("channel") or "").lower()
    severity = (group.get("severity") or "").lower()

    for pat in PATTERNS:
        if "channel" in pat and channel != pat["channel"].lower():
            continue
        if "severity" in pat and severity != pat["severity"].lower():
            continue
        for regex in pat["match"]:
            if re.search(regex, text, re.IGNORECASE):
                return Cause(
                    title=pat["title"],
                    explanation=pat["explanation"],
                    suggested_fix=pat["suggested_fix"],
                    confidence=pat["confidence"],
                    pattern_id=pat["id"],
                )

    return Cause(
        title="Undiagnosed by drover's pattern library",
        explanation=(
            "No known pattern matched this fingerprint. Inspect the "
            "sample line(s) and the channel name for clues about what's "
            "failing — file: line markers, exception class names, and "
            "request_id correlations are usually enough to localize it."
        ),
        suggested_fix=(
            "If this issue recurs, add a pattern entry to "
            "drover/scripts/causes.py so the next report diagnoses it "
            "automatically."
        ),
        confidence="low",
        pattern_id=None,
    )
