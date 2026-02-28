# DDEV Instance Management Protocol

## Purpose
Enable rapid validator reuse across multiple worktrees by stopping (not deleting) DDEV instances after validation completes, preserving cached docker artifacts for fast restart.

## When to Apply
- After a reviewer completes review on a worktree
- Before the validator is assigned to the next worktree
- When idle agent should release resources but preserve state for reuse

## Instance Lifecycle

### 1. Stop DDEV Instance (Release Resources)

## Context Awareness
**Important**: All relative paths (e.g. `./worktrees/...`) assume you are executing from the **Project Root** (e.g. `~/OpenSource/SAME_PAGE_PREVIEW`).
- The Project Root is the folder that *contains* the `worktrees/` and `kanban/` directories.
- If you are inside a worktree (e.g. `.../worktrees/1234`), you must `cd ../..` to return to the Project Root before running commands.

```bash
cd ./worktrees/{ISSUE_NUMBER}
ddev stop
```

This:
- Stops running containers (frees memory/CPU)
- Preserves volumes (database, Mutagen sync state)
- Preserves images (cached webserver, db, chrome)
- Keeps all docker artifacts intact

### 2. Restart DDEV Instance (Fast Reuse)
```bash
cd ./worktrees/{ISSUE_NUMBER}
ddev start
```

Since docker artifacts are preserved, startup is much faster than initial build (~1-2 min vs 3-5 min for fresh build).

### 3. Full Cleanup (Manual Resource Recovery)
When needed to reclaim significant disk/memory:
```bash
ddev delete --omit-snapshot  # Deletes containers, volumes, images
docker volume prune          # Clean unused volumes
docker builder prune         # Clean builder cache
```

User will do this manually when resource pressure is critical. This is infrequent with proper instance management.

## Resource Impact

### Per Instance (Running)
- Memory: ~500 MB - 1 GB
- Disk: N/A (volumes cached, not counted against active)
- CPU: Minimal when idle

### Per Instance (Stopped, Cached)
- Memory: 0 MB (containers stopped)
- Disk: 2-4 GB (volumes cached locally)
- Rebuild time on restart: ~1-2 min (from cache)
- vs. Fresh build time: ~3-5 min (from scratch)

## Benefits

1. **Rapid Validator Reuse**: Stop/start cycle is 1/3 the time of spawn/build cycle
2. **Reduces Memory Contention**: Stopped instances use no memory while preserving all state
3. **Preserves Build Cache**: Next validator gets benefits of compiled assets, dependencies pre-installed
4. **Low Maintenance**: Docker purge only needed manually when disk exhaustion occurs (rare)
5. **Better Pipeline Throughput**: More validators can rotate through same instance set

## Validator Checklist

When completing review, reviewer agents should:
- [ ] Run all quality gates (phpcs, phpstan, phpunit)
- [ ] Document results in kanban card
- [ ] Update task status to "completed" or "blocked"
- [ ] Run `ddev stop` to release resources
- [ ] Verify stop with `docker ps` (instance should not appear)
- [ ] Ready for next assignment or shutdown

## Integration with Team Sprint

The sprint-run skill should call this in the validator teardown phase:
```yaml
validation-complete:
  - run-all-quality-gates
  - record-results-to-kanban
  - ddev-stop-for-reuse    # <-- Release resources, keep cache
  - update-task-status
  - notify-team-lead
```

## Comparison: Stop vs. Delete

| Operation | Memory | Disk | Restart Time | Use Case |
|-----------|--------|------|--------------|----------|
| `ddev stop` | 0 MB | 2-4 GB cached | 1-2 min (cached) | Normal validator rotation |
| `ddev delete` | 0 MB | Reclaimed | 3-5 min (fresh) | Emergency resource recovery |

**Default behavior: Always `ddev stop`**
**Only `ddev delete` when explicitly requested or resource pressure critical**

## Troubleshooting

**Instance won't stop**:
```bash
docker ps | grep drupal-{ISSUE_NUMBER}
docker stop <container-id>
ddev stop
```

**Need to see stop status**:
```bash
ddev list  # Shows all projects and their status (running, stopped, not-running)
```

**Reclaim disk space (if needed)**:
```bash
# User manual cleanup when resource pressure is high
ddev delete --omit-snapshot  # One project
docker system prune --all    # All unused docker resources
```
