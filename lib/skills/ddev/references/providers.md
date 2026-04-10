# DDEV Provider Patterns

Providers define how `ddev pull <name>` fetches databases and files from remote environments.

## Provider file structure

Files live in `.ddev/providers/<name>.yaml` and define three commands:

```yaml
auth_command:         # validate credentials before pulling
  command: |
    ...

db_pull_command:      # fetch DB to .ddev/.downloads/db.sql.gz
  command: |
    ...
  service: web        # runs inside the web container

files_pull_command:   # fetch files to .ddev/.downloads/files/
  command: |
    ...
  service: web
```

All commands run inside the DDEV web container. Paths like `/var/www/html/` reference the container filesystem, not the host.

## Environment variables

Set credentials in `web_environment` in `config.local.yaml` (gitignored):

```yaml
# .ddev/config.local.yaml
web_environment:
  - REMOTE_DB_HOST=db.example.com
  - REMOTE_DB_USER=myuser
  - REMOTE_DB_PASS=secret
  - REMOTE_DB_NAME=mydb
```

After changing env vars, `ddev restart` for them to take effect.

## Pattern 1: Direct mysqldump

Use when the database host is reachable from the DDEV container (public endpoint, VPN, etc.). Simplest pattern -- no SSH needed.

```yaml
auth_command:
  command: |
    set -eu -o pipefail
    if [ -z "${REMOTE_DB_HOST:-}" ]; then
      echo "ERROR: REMOTE_DB_HOST not set in web_environment"
      exit 1
    fi
    echo "Config validated: ${REMOTE_DB_HOST}"

db_pull_command:
  command: |
    set -eu -o pipefail
    mysqldump \
      -h "${REMOTE_DB_HOST}" \
      -u "${REMOTE_DB_USER}" \
      -p"${REMOTE_DB_PASS}" \
      --no-tablespaces \
      --single-transaction \
      "${REMOTE_DB_NAME}" | gzip > /var/www/html/.ddev/.downloads/db.sql.gz

    DB_SIZE=$(ls -lh /var/www/html/.ddev/.downloads/db.sql.gz | awk '{print $5}')
    echo "DB downloaded (${DB_SIZE})"
  service: web

files_pull_command:
  command: "echo 'No files pull configured'"
  service: web
```

### When to use
- Managed databases with public endpoints (RDS, Cloud SQL, PlanetScale)
- Databases accessible via VPN from the host machine

## Pattern 2: SSH tunnel

Use when the database is only reachable from a remote server (common with Rackspace Cloud Databases, private-network RDS).

```yaml
auth_command:
  command: |
    set -eu -o pipefail
    if [ -z "${SSH_HOST:-}" ]; then echo "ERROR: SSH_HOST not set"; exit 1; fi
    if [ -z "${SSH_USER:-}" ]; then echo "ERROR: SSH_USER not set"; exit 1; fi
    ssh-add -l >/dev/null || (echo "ERROR: No SSH keys. Run 'ddev auth ssh' first."; exit 1)
    echo "Config validated: ${SSH_USER}@${SSH_HOST}"

db_pull_command:
  command: |
    set -eu -o pipefail
    SSH_PORT="${SSH_PORT:-22}"
    REMOTE_FILE="/tmp/ddev_db_$(date +%Y%m%d_%H%M%S).sql.gz"

    # Dump on remote server, download, clean up
    ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} \
      "mysqldump -h ${DB_HOST} -u ${DB_USER} -p'${DB_PASS}' \
       --no-tablespaces --single-transaction ${DB_NAME} \
       | gzip > ${REMOTE_FILE}"

    scp -P ${SSH_PORT} ${SSH_USER}@${SSH_HOST}:${REMOTE_FILE} \
      /var/www/html/.ddev/.downloads/db.sql.gz

    ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} "rm -f ${REMOTE_FILE}"

    DB_SIZE=$(ls -lh /var/www/html/.ddev/.downloads/db.sql.gz | awk '{print $5}')
    echo "DB downloaded (${DB_SIZE})"
  service: web
```

### SSH auth

Provider commands run inside the DDEV container. Forward host SSH keys first:

```bash
ddev auth ssh
```

This only needs to run once per terminal session. If `ddev pull` hangs or gets "Permission denied", this is almost always the cause.

### Heredoc gotcha

When using `<<'EOF'` (single-quoted delimiter) for remote commands, local variables do NOT expand. Use double-quoted `<<"EOF"` or pass variables explicitly:

```bash
# WRONG -- $REMOTE_FILE won't expand inside single-quoted heredoc
ssh user@host "bash -s" <<'EOF'
  mysqldump ... | gzip > ${REMOTE_FILE}
EOF

# RIGHT -- double-quoted heredoc allows variable expansion
ssh user@host "bash -s" <<"EOF"
  mysqldump ... | gzip > ${REMOTE_FILE}
EOF

# ALSO RIGHT -- inline command string
ssh user@host "mysqldump ... | gzip > ${REMOTE_FILE}"
```

## Pattern 3: SSH with wp-cli or drush

Use when the remote server has CMS CLI tools installed. Simpler than extracting DB credentials manually.

```yaml
db_pull_command:
  command: |
    set -eu -o pipefail
    SSH_PORT="${SSH_PORT:-22}"
    REMOTE_FILE="/tmp/ddev_db_$(date +%Y%m%d_%H%M%S).sql.gz"

    ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} \
      "cd ${WEBROOT} && wp db export - | gzip > ${REMOTE_FILE}"

    scp -P ${SSH_PORT} ${SSH_USER}@${SSH_HOST}:${REMOTE_FILE} \
      /var/www/html/.ddev/.downloads/db.sql.gz

    ssh -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} "rm -f ${REMOTE_FILE}"
  service: web
```

Replace `wp db export -` with `drush sql-dump` for Drupal.

## Pattern 4: Files via rsync

```yaml
files_pull_command:
  command: |
    set -eu -o pipefail
    SSH_PORT="${SSH_PORT:-22}"
    FILES_PATH="${FILES_PATH:-${WEBROOT}/wp-content/uploads}"

    rsync -avzh \
      -e "ssh -p ${SSH_PORT}" \
      --stats \
      --exclude=".git/" \
      --exclude="*.log" \
      --exclude="cache/" \
      ${SSH_USER}@${SSH_HOST}:${FILES_PATH}/ \
      /var/www/html/.ddev/.downloads/files/
  service: web
```

## Managed database gotchas

### Rackspace Cloud Databases
- No filesystem access to the DB host -- must use mysqldump over the network
- Typically only reachable from Cloud Servers on the same account (use SSH tunnel pattern)
- If backups (UpdraftPlus, etc.) fail with 0-byte dumps, check disk space on the web server first

### AWS RDS / Aurora
- Public endpoint available if configured; otherwise use SSH tunnel through a bastion/EC2
- Add `--set-gtid-purged=OFF` to mysqldump if GTID is enabled

### PlanetScale / Cloud SQL
- Usually have public endpoints with SSL required
- Add `--ssl-mode=REQUIRED` to mysqldump

## Debugging providers

```bash
# Test auth step only
ddev pull <provider> --skip-db --skip-files

# Verbose SSH (add to the ssh command in the provider)
ssh -v -p ${SSH_PORT} ${SSH_USER}@${SSH_HOST} ...

# Check env vars are set in the container
ddev exec env | grep REMOTE
ddev exec env | grep SSH

# Check downloaded file
ddev exec ls -lh /var/www/html/.ddev/.downloads/
```

Common failures:

| Symptom | Cause | Fix |
|---|---|---|
| `Permission denied (publickey)` | SSH key not forwarded | Run `ddev auth ssh` |
| Hangs on SSH | Firewall or wrong port | Verify `ssh -p PORT user@host` works from host first |
| 0-byte download | Disk full on remote, or credentials wrong | Check remote disk space; verify credentials manually |
| `mysqldump: Got error: 1044` | User lacks dump privileges | Need SELECT and LOCK TABLES grants |
| File downloaded but import fails | Wrong format or corrupt gzip | `gunzip -t file.sql.gz` to verify integrity |
