# DDEV Troubleshooting

## Diagnostic sequence

Run these in order when something isn't working:

```bash
# 1. Is it running?
ddev status

# 2. Container health
ddev describe --json-output | jq '.raw.services | to_entries[] | {name: .key, status: .value.status}'

# 3. Web container logs
ddev logs

# 4. Database container logs
ddev logs -s db

# 5. Real-time log following
ddev logs -f

# 6. Mutagen sync health
ddev utility mutagen-diagnose

# 7. Port conflicts
ddev debug router-ports
```

## Container log patterns

| Pattern | Meaning | Fix |
|---|---|---|
| `Killed` or `OOM` | Out of memory | Increase Docker memory allocation in Docker Desktop settings |
| `Segmentation fault` | PHP extension crash | Check xdebug/xhprof state; `ddev xdebug off` to rule out |
| `No space left on device` | Docker disk full | `docker system prune` or increase disk allocation |
| `Connection refused` | Container not ready or crashed | `ddev restart` |
| `upstream timed out` | PHP-FPM process too slow | Increase `max_execution_time` or investigate the slow code |
| `worker_connections are not enough` | Too many concurrent connections | Restart; usually transient |

## Mutagen sync issues

Symptoms:
- Files not appearing in container after editing on host
- Slow or stalled sync on startup (>60s warning)
- Permission errors in the container

```bash
ddev utility mutagen-diagnose    # detailed diagnostics
ddev utility mutagen-reset       # nuclear: reset sync state completely
```

After `mutagen-reset`, run `ddev start` -- it will re-sync from scratch.

## Port conflicts

```bash
ddev debug router-ports
```

If another service (Apache, nginx, MAMP) holds port 80/443:

```bash
# Find what's on port 80
sudo lsof -i :80

# Option 1: change DDEV's ports globally
ddev config global --router-http-port=8080 --router-https-port=8443

# Option 2: stop the conflicting service
```

## Docker resource issues

```bash
# Check Docker disk usage
docker system df

# Clean unused images, containers, volumes
docker system prune

# More aggressive (removes all unused volumes too)
docker system prune --volumes
```

Signs of Docker resource exhaustion:
- Containers fail to start with vague errors
- `ddev start` hangs during "Building project images"
- Database imports fail partway through

## Error table

| Symptom | Cause | Fix |
|---|---|---|
| `Could not connect to docker` | Docker not running | Start Docker Desktop |
| `container is unhealthy` | Service crashed during startup | `ddev restart`; check `ddev logs -s <service>` |
| `Mutagen sync timed out` | Large initial sync or conflict | `ddev utility mutagen-reset` then `ddev start` |
| `port already allocated` | Another process on 80/443 | `ddev debug router-ports`; stop conflict or change ports |
| `Table 'db.wp_options' doesn't exist` | Wrong table prefix | Check `WORDPRESS_TABLE_PREFIX`; `ddev restart` |
| `Error establishing a database connection` | DB container down or creds wrong | `ddev describe` for DB status; `ddev restart` |
| `502 Bad Gateway` | PHP-FPM crashed | `ddev logs` for root cause; `ddev restart` |
| `ddev pull` hangs | SSH key not forwarded | `ddev auth ssh` |
| Import OK but site blank | URL mismatch in DB | WP: check siteurl/home; Drupal: check trusted_host_patterns |
| `project name already in use` | Another worktree using same name | Set unique `name` in `config.local.yaml` or use `project_tld` |
| `ddev start` warns about config | Config changed since last start | `ddev restart` to pick up changes |
| PHP memory errors | Default 256M too low | Add `php_ini_override` in config.yaml: `memory_limit = 512M` |

## Self-signed certificate issues

DDEV uses self-signed certs for HTTPS. Browsers will warn; CLI tools need flags:

```bash
# curl
curl -k https://mysite.ddev.site

# wget
wget --no-check-certificate https://mysite.ddev.site

# Lighthouse (Chrome flag)
lighthouse <url> --chrome-flags="--ignore-certificate-errors"
```

To trust DDEV's CA system-wide (macOS):

```bash
mkcert -install   # DDEV uses mkcert; this trusts its CA
```
