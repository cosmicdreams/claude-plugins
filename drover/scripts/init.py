#!/usr/bin/env python3
"""drover.init — discover Drupal/Acquia config and write `.drover/manifest.json`.

Operates from the project root. Finds breadcrumbs locally, resolves the
Acquia application via the Cloud Platform API, enumerates envs and the
available log types per env, filters to the application-error subset
(apache-error, drupal-watchdog, php-error), and writes a manifest.

CLI:
  python3 init.py [--project ROOT] [--app NAME] [--force]
                  [--types csv] [--dry-run]

The --app override is for the rare multi-match case (e.g. "AHRI" vs
"AHRI-Prototypes" both visible to the same Acquia user). Without it,
init aborts on ambiguity and lists candidates.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Reuse the AcquiaClient from sibling module (slice-1's patch).
sys.path.insert(0, str(Path(__file__).parent / "monitors"))
from acquia_api import AcquiaClient, AcquiaAPIError  # noqa: E402


APP_ERROR_TYPES = ("apache-error", "drupal-watchdog", "php-error")
DEFAULT_RETENTION_DAYS = 30


# --- Breadcrumb discovery -------------------------------------------------

class Breadcrumbs:
    """Bag of inferred-from-disk hints used to resolve the Acquia app."""

    def __init__(self) -> None:
        self.drush_envs: list[dict] = []   # [{name, uri, host}, ...]
        self.composer_name: str | None = None
        self.composer_acquia_deps: list[str] = []
        self.ddev_name: str | None = None
        self.git_remote: str | None = None
        self.has_acquia_pipelines: bool = False

    def site_hosts(self) -> list[str]:
        """SSH/site hosts mentioned in drush aliases — best matchers."""
        out: list[str] = []
        for e in self.drush_envs:
            if e.get("host"):
                out.append(e["host"])
        return out

    def site_uris(self) -> list[str]:
        out: list[str] = []
        for e in self.drush_envs:
            if e.get("uri"):
                out.append(e["uri"])
        return out

    def name_candidates(self) -> list[str]:
        """Name fragments to fuzzy-match Acquia application names."""
        out: list[str] = []
        for u in self.site_uris():
            host = re.sub(r"^https?://", "", u).split("/")[0]
            host = host.replace("www.", "")
            out.append(host.split(".")[0])
        if self.composer_name:
            # "vendor/project" → ["project"]
            tail = self.composer_name.split("/")[-1]
            out.append(tail)
        if self.ddev_name:
            out.append(self.ddev_name)
        # SSH host prefix is like "pncbdev.ssh.prod.acquia-sites.com" → "pncbdev"
        for h in self.site_hosts():
            out.append(h.split(".")[0])
        # dedupe preserving order
        seen, dedup = set(), []
        for c in out:
            cl = c.lower()
            if cl not in seen and cl:
                seen.add(cl)
                dedup.append(cl)
        return dedup

    def is_acquia_project(self) -> bool:
        """True if any signal says this looks like an Acquia project."""
        return bool(
            self.drush_envs
            or self.composer_acquia_deps
            or self.has_acquia_pipelines
        )

    def empty(self) -> bool:
        return not (
            self.drush_envs
            or self.composer_name
            or self.ddev_name
            or self.has_acquia_pipelines
        )


def _parse_drush_site_yml(text: str) -> list[dict]:
    """Tiny line-based reader for drush *.site.yml files.

    Drush's site files use a flat schema:
      env_name:
        host: ...
        uri: ...
        paths: {...}
        user: ...
      another_env:
        ...

    Returns one dict per top-level env block. Skips blocks without a host
    or uri (those aren't Acquia targets).
    """
    envs: list[dict] = []
    current: dict | None = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        # top-level env header (no leading whitespace, ends with ':')
        m = re.match(r"^([A-Za-z0-9_.\-]+):\s*$", line)
        if m:
            if current and (current.get("host") or current.get("uri")):
                envs.append(current)
            current = {"name": m.group(1)}
            continue
        if current is None:
            continue
        m = re.match(r"^\s+([a-zA-Z_]+):\s*['\"]?(.*?)['\"]?\s*$", line)
        if m:
            key, val = m.group(1), m.group(2)
            if key in ("host", "uri", "user"):
                current[key] = val
    if current and (current.get("host") or current.get("uri")):
        envs.append(current)
    return envs


def _read_optional_yaml_name(path: Path) -> str | None:
    """Pull `name: <value>` from a tiny YAML file (.ddev/config.yaml etc)."""
    if not path.exists():
        return None
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return None
    m = re.search(r"^\s*name:\s*['\"]?([^'\"\s]+)['\"]?\s*$", text, re.M)
    return m.group(1) if m else None


def discover_breadcrumbs(project_root: Path) -> Breadcrumbs:
    b = Breadcrumbs()

    # 1. Drush aliases (D8+ — drush/sites/*.site.yml)
    drush_dir = project_root / "drush" / "sites"
    if drush_dir.is_dir():
        for site_file in sorted(drush_dir.glob("*.site.yml")):
            try:
                envs = _parse_drush_site_yml(
                    site_file.read_text(errors="replace"),
                )
            except OSError:
                continue
            for e in envs:
                e["__source"] = str(site_file.name)
                b.drush_envs.append(e)

    # 2. composer.json
    composer = project_root / "composer.json"
    if composer.exists():
        try:
            data = json.loads(composer.read_text(errors="replace"))
            b.composer_name = data.get("name")
            req = {**data.get("require", {}), **data.get("require-dev", {})}
            b.composer_acquia_deps = [
                k for k in req if k.startswith("acquia/")
            ]
        except (OSError, json.JSONDecodeError):
            pass

    # 3. DDEV
    b.ddev_name = _read_optional_yaml_name(
        project_root / ".ddev" / "config.yaml",
    )

    # 4. Git remote
    try:
        out = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=project_root, capture_output=True, text=True, check=False,
        )
        if out.returncode == 0:
            b.git_remote = out.stdout.strip() or None
    except FileNotFoundError:
        pass

    # 5. Acquia pipelines marker
    b.has_acquia_pipelines = (
        project_root / "acquia-pipelines.yml"
    ).exists() or (project_root / "acquia-pipelines.yaml").exists()

    return b


# --- Acquia matching ------------------------------------------------------

def _domains_for_env(env: dict) -> list[str]:
    return [d for d in (env.get("domains") or []) if d]


def score_app_match(
    app: dict, app_envs: list[dict], breadcrumbs: Breadcrumbs,
) -> int:
    """Return a numeric match score; higher is better."""
    score = 0

    # Domain matches are the strongest signal
    candidate_uris = {
        re.sub(r"^https?://", "", u).rstrip("/").lower()
        for u in breadcrumbs.site_uris()
    }
    candidate_uris |= {u.replace("www.", "") for u in candidate_uris}

    candidate_hosts = {h.lower() for h in breadcrumbs.site_hosts()}
    candidate_host_prefixes = {h.split(".")[0] for h in candidate_hosts}

    for env in app_envs:
        for dom in _domains_for_env(env):
            d = dom.lower()
            d_no_www = d.replace("www.", "")
            if d in candidate_uris or d_no_www in candidate_uris:
                score += 100
            for host in candidate_hosts:
                if d == host or d.split(".")[0] == host.split(".")[0]:
                    score += 80
        ssh = (env.get("ssh_url") or "").lower()
        for host in candidate_hosts:
            if host in ssh or ssh.split("@")[-1].startswith(
                host.split(".")[0]
            ):
                score += 60

    # Name fragment fuzzy match — secondary
    name_lc = (app.get("name") or "").lower()
    for cand in breadcrumbs.name_candidates():
        if not cand:
            continue
        if cand == name_lc:
            score += 40
        elif cand in name_lc or name_lc in cand:
            score += 20
        # Also test against the slug
        for prefix in candidate_host_prefixes:
            if prefix and prefix == name_lc:
                score += 30

    return score


def match_acquia_app(
    client: AcquiaClient, breadcrumbs: Breadcrumbs,
) -> list[tuple[int, dict, list[dict]]]:
    """Return [(score, app, app_envs)] sorted by score desc, score>0 only."""
    apps = client.list_applications()
    scored: list[tuple[int, dict, list[dict]]] = []
    for app in apps:
        try:
            envs = client.list_environments(app["uuid"])
        except Exception:
            envs = []
        s = score_app_match(app, envs, breadcrumbs)
        if s > 0:
            scored.append((s, app, envs))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored


# --- Manifest assembly ----------------------------------------------------

def build_manifest(
    client: AcquiaClient,
    app: dict,
    app_envs: list[dict],
    *,
    types_filter: tuple[str, ...] = APP_ERROR_TYPES,
    project_slug: str | None = None,
) -> dict:
    """Resolve every env's available log types and assemble a manifest dict."""
    envs_out: list[dict] = []
    for env in app_envs:
        try:
            log_types = client.list_log_types(env["id"])
        except Exception:
            log_types = []
        names_available = {
            t.get("type") for t in log_types if t.get("type")
        }
        types_keep = [t for t in types_filter if t in names_available]
        if not types_keep:
            # Env exists but doesn't expose any of our app-error types —
            # still record it so report skill knows about it; mark
            # explicitly so operators can spot the gap.
            types_keep = []
        envs_out.append({
            "name": env.get("name", ""),
            "env_id": env.get("id", ""),
            "default_domain": env.get("default_domain", ""),
            "types": types_keep,
        })

    return {
        "project": project_slug or (
            app.get("name", "") or ""
        ).lower().replace(" ", "-"),
        "hosting": "drupal-acquia",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "drover_schema_version": 1,
        "acquia": {
            "app_uuid": app.get("uuid", ""),
            "app_name": app.get("name", ""),
            "envs": envs_out,
        },
        "retention_days": DEFAULT_RETENTION_DAYS,
    }


def _pick_project_slug(
    bc: Breadcrumbs,
    app: dict,
    app_envs: list[dict] | None = None,
) -> str:
    """Pick a short, stable project slug for the manifest.

    Priority:
      1. Single drush alias filename (drush/sites/pncb.site.yml -> 'pncb').
      2. With multiple drush files (multi-site project): the one whose URI
         or host actually matches a real env domain on the matched app.
         The defunct site (e.g. ipn.site.yml at PNCB) doesn't match any
         current env domain so it's correctly skipped.
      3. composer.json `name` tail (vendor/<tail> -> <tail>).
      4. DDEV name. Lowest priority — often shared infra (e.g. PNCB and
         AHRI both ship with `name: docker-starter`).
      5. Slugified Acquia app name. Long but always present.
    """
    if bc.drush_envs:
        sources = sorted({
            e["__source"] for e in bc.drush_envs if e.get("__source")
        })
        if len(sources) == 1:
            slug = sources[0].replace(".site.yml", "")
            if slug and slug not in {"self", "default", "local"}:
                return slug
        if len(sources) > 1 and app_envs:
            # Tier 1 (most specific): the env's canonical default_domain.
            # An env can serve many domains (multi-site hosting) — both
            # ipn.* and pncb.* may be in env.domains[], but only one
            # matches the env's default_domain. That's the live site.
            primary_domains: set[str] = set()
            # Tier 2: every alt domain the env serves.
            alias_domains: set[str] = set()
            # Tier 3: the SSH host (often shared between sibling drush files).
            ssh_hosts: set[str] = set()
            for env in app_envs:
                dd = (env.get("default_domain") or "").lower()
                if dd:
                    primary_domains.add(dd)
                    primary_domains.add(dd.replace("www.", ""))
                for d in env.get("domains", []) or []:
                    dl = d.lower()
                    alias_domains.add(dl)
                    alias_domains.add(dl.replace("www.", ""))
                ssh = (env.get("ssh_url") or "").lower()
                if ssh:
                    ssh_hosts.add(ssh.split("@")[-1])

            def _uri_host(fe: dict) -> str:
                uri = (fe.get("uri") or "").lower()
                return re.sub(r"^https?://", "", uri).rstrip("/")

            for tier in (primary_domains, alias_domains):
                for src in sources:
                    stem = src.replace(".site.yml", "")
                    file_envs = [
                        e for e in bc.drush_envs
                        if e.get("__source") == src
                    ]
                    for fe in file_envs:
                        h = _uri_host(fe)
                        if h in tier or h.replace("www.", "") in tier:
                            return stem
            # Last resort: match by drush `host:` against ssh hosts.
            for src in sources:
                stem = src.replace(".site.yml", "")
                file_envs = [
                    e for e in bc.drush_envs
                    if e.get("__source") == src
                ]
                for fe in file_envs:
                    h = (fe.get("host") or "").lower()
                    if h and h in ssh_hosts:
                        return stem
    if bc.composer_name:
        tail = bc.composer_name.split("/")[-1]
        if tail and tail not in {"docker-starter", "drupal-project",
                                 "recommended-project"}:
            return tail
    if bc.ddev_name and bc.ddev_name not in {
        "docker-starter", "drupal-project",
    }:
        return bc.ddev_name
    return (app.get("name") or "").lower().replace(" ", "-") or "drupal"


def manifest_path(project_root: Path) -> Path:
    return project_root / ".drover" / "manifest.json"


def write_manifest(project_root: Path, manifest: dict) -> Path:
    p = manifest_path(project_root)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    os.replace(tmp, p)
    return p


# --- CLI ------------------------------------------------------------------

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="drover-init",
        description="Discover Drupal/Acquia config and write "
                    ".drover/manifest.json.",
    )
    p.add_argument(
        "--project", type=Path, default=Path.cwd(),
        help="project root (default: cwd)",
    )
    p.add_argument(
        "--app", default=None,
        help="explicit Acquia application name when discovery is "
             "ambiguous (e.g. 'AHRI'). Case-insensitive substring match.",
    )
    p.add_argument(
        "--types", default=None,
        help=f"comma-separated log-type allow-list "
             f"(default: {','.join(APP_ERROR_TYPES)})",
    )
    p.add_argument(
        "--project-slug", default=None,
        help="explicit project slug (overrides automatic pick)",
    )
    p.add_argument(
        "--force", action="store_true",
        help="overwrite an existing manifest",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="show what would be written; don't touch disk",
    )
    return p.parse_args(argv)


def cli_main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    project_root = args.project.resolve()

    target = manifest_path(project_root)
    if target.exists() and not args.force:
        print(
            f"ERROR: {target} exists. Re-run with --force to overwrite.",
            file=sys.stderr,
        )
        return 2

    print(f"discovering breadcrumbs in {project_root}")
    bc = discover_breadcrumbs(project_root)
    if bc.empty():
        print(
            "ERROR: no Drupal/Acquia breadcrumbs found in this project.\n"
            "       Drover 2.0 currently only supports Drupal/Acquia.\n"
            "       Looked for: drush/sites/*.site.yml, composer.json,\n"
            "                   .ddev/config.yaml, acquia-pipelines.yml",
            file=sys.stderr,
        )
        return 2
    if not bc.is_acquia_project():
        print(
            "WARNING: project found, but no Acquia-specific signals "
            "(no acquia/* composer dep, no acquia-pipelines.yml). "
            "Continuing with name-only matching — multiple app candidates "
            "may surface; use --app to disambiguate.",
            file=sys.stderr,
        )
    print(
        f"  drush envs: {len(bc.drush_envs)}  "
        f"composer name: {bc.composer_name}  "
        f"ddev name: {bc.ddev_name}  "
        f"acquia/* deps: {len(bc.composer_acquia_deps)}  "
        f"pipelines.yml: {bc.has_acquia_pipelines}"
    )

    try:
        client = AcquiaClient()
    except FileNotFoundError as e:
        print(
            f"ERROR: {e}\n       Run `acli auth:login` then re-run "
            f"/drover:init.",
            file=sys.stderr,
        )
        return 2

    if not client.verify_credentials():
        print(
            "ERROR: Acquia credentials present but invalid. "
            "Re-run `acli auth:login`.",
            file=sys.stderr,
        )
        return 2

    print("matching against Acquia applications...")
    matches = match_acquia_app(client, bc)
    if not matches:
        print(
            "ERROR: no Acquia application matched. Use --app NAME to "
            "force, or check that this user has access to the app.",
            file=sys.stderr,
        )
        return 2

    if args.app:
        wanted = args.app.lower()
        narrowed = [
            m for m in matches
            if wanted in (m[1].get("name") or "").lower()
        ]
        if not narrowed:
            print(
                f"ERROR: --app '{args.app}' didn't match any candidate. "
                f"Candidates were:",
                file=sys.stderr,
            )
            for s, app, _envs in matches:
                print(f"  - {app.get('name')} (score={s})", file=sys.stderr)
            return 2
        matches = narrowed

    if len(matches) > 1 and matches[0][0] == matches[1][0]:
        # Top score is tied — ambiguous; require --app
        print(
            "ERROR: multiple apps match equally. Pick one with --app NAME:",
            file=sys.stderr,
        )
        for s, app, _envs in matches[:5]:
            print(
                f"  - {app.get('name')} ({app.get('uuid')}) score={s}",
                file=sys.stderr,
            )
        return 2

    score, app, app_envs = matches[0]
    print(
        f"matched: {app.get('name')} ({app.get('uuid')}) score={score} "
        f"envs={[e.get('name') for e in app_envs]}"
    )

    types_filter = APP_ERROR_TYPES
    if args.types:
        types_filter = tuple(
            t.strip() for t in args.types.split(",") if t.strip()
        )

    project_slug = args.project_slug or _pick_project_slug(
        bc, app, app_envs,
    )

    print("enumerating env log types...")
    manifest = build_manifest(
        client, app, app_envs,
        types_filter=types_filter,
        project_slug=project_slug,
    )

    if args.dry_run:
        print("\n--- dry-run manifest (NOT written) ---")
        print(json.dumps(manifest, indent=2, sort_keys=True))
        return 0

    written = write_manifest(project_root, manifest)
    print(f"\nwrote: {written}")
    print(f"  app:    {manifest['acquia']['app_name']}")
    print(f"  envs:   {len(manifest['acquia']['envs'])}")
    for env in manifest["acquia"]["envs"]:
        ts = env.get("types") or []
        print(f"    - {env['name']:8} types={ts}")
    print("\nNext: /drover:acquia-pull --env <name> --daily")
    return 0


if __name__ == "__main__":
    sys.exit(cli_main())
