# Team Communication Protocol

## Core Principle
**User sees results. Internal comms save tokens.**

## Internal Team Messages

### Format
- Short words/abbrevs
- Emojis for status ✅❌⚠️🔄
- No verbose formatting
- No celebrations/humanization
- Facts only

### Abbreviations
- `ana` = analysis/analyzed
- `impl` = implementation/implement
- `tst` = test(s)
- `qa` = quality assurance
- `std` = standards
- `cov` = coverage
- `wrk` = worktree
- `rpt` = report
- `iss` = issue
- `mod` = module
- `phpcs` = coding standards
- `phpunit` = tests
- `d.o` = drupal.org
- `bc` = breaking change
- `ok` = pass/approved
- `nok` = fail/blocked
- `xr` = cross-review

### Status Emojis
- ✅ = done/pass
- ❌ = fail/blocked
- ⚠️ = warning/issue
- 🔄 = in progress
- ⏸️ = waiting/blocked
- 📝 = report ready

### Example Messages

**Bad (verbose):**
```
Hello team-lead! I have completed the full analysis, implementation,
and validation of issue #3543210. All tests pass and coding standards
are clean. The fix is ready for cross-review.
```

**Good (concise):**
```
✅ #3543210 slice done
phpcs: ok
phpunit: ok
wrk: worktrees/3543210/
cross-review: yes
```

**Bad:**
```
Unfortunately, the cross-review has found several issues that
need to be addressed before this can be merged...
```

**Good:**
```
❌ #3543210 xr fail
stubs: settings_tray.js:45 (TODO left as impl)
tst: test doesn't exercise bug scenario
needs fix
```

## External (Team Lead → User)

### Format
- Natural language
- Concise but complete
- Results-focused
- File paths when relevant
- Hide internal process

### Examples

**Good:**
```
Issue #3543210 complete. Simple routing bug - double
slash in URL caused 404. Fix in worktrees/3543210/.
All tests pass, coding standards clean. Ready to submit.
```

**Bad:**
```
slice-1 reported the slice is complete. Cross-reviewer
is now validating the implementation...
```

## Key Rules

1. **Team → Team**: Max concise, abbrevs, emojis, facts
2. **Team Lead → User**: Natural language, results
3. **No humanization**: No "Hello", "Thanks", "Great job"
4. **No celebrations**: No "Successfully", "Happy to report"
5. **No process exposition**: User doesn't see internal workflow
6. **Facts only**: What happened, what's next
7. **Token efficiency**: Every word counts in team messages

## Summary Templates

### For slice-worker → team-lead
```
[emoji] #[issue] slice done
phpcs: [ok|nok]
phpunit: [ok|nok]
wrk: [path]
cross-review: [yes|no]
[issues if any]
```

### For cross-reviewer → team-lead (pass)
```
✅ #[issue] xr pass
phpcs: ok
phpstan: ok
phpunit: ok
```

### For cross-reviewer → team-lead (fail)
```
❌ #[issue] xr fail
[gate]: [N errors] | [file:line]
[what needs fixing]
```

### For process-improvement → team-lead
```
[emoji] [improvement type]
[what changed]
[impact]
```
