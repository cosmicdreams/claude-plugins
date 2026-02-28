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
- `ana` = analysis/analyzer
- `impl` = implementation/implement
- `val` = validation/validator
- `qa` = quality assurance
- `std` = standards
- `cov` = coverage
- `wrk` = worktree
- `rpt` = report
- `iss` = issue
- `mod` = module
- `tst` = test(s)
- `phpcs` = coding standards
- `phpunit` = tests
- `d.o` = drupal.org
- `bc` = breaking change
- `ok` = pass/approved
- `nok` = fail/blocked

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
Hello team-lead! I have completed the comprehensive analysis
of issue #3543210. The analysis report has been successfully
generated and saved to the analysis-reports directory.
I found that this is a relatively simple bug fix...
```

**Good (concise):**
```
📝 #3543210 ana done
rpt: .claude/analysis-reports/3543210.md
complexity: simple
effort: 2h
ready for impl
```

**Bad:**
```
I have successfully completed the implementation and all
tests are passing! The code follows all Drupal standards.
```

**Good:**
```
✅ #3543210 impl done
phpcs: ok
phpunit: ok
wrk: worktrees/3543210/
ready for val
```

**Bad:**
```
Unfortunately, the validation has failed. There are several
coding standards violations that need to be addressed...
```

**Good:**
```
❌ review fail
phpcs: 3 errors (file.php:45,67,89)
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
Analyzed issue #3543210. It's a simple routing bug - double
slash in URL causes 404. Fix will take ~2 hours.

Implementation ready in worktrees/3543210/. Validated - all
tests pass, coding standards clean. Ready to submit.
```

**Bad:**
```
issue-analyzer reported analysis complete. Waiting for
implementer to finish implementation. reviewer
will check after...
```

## Key Rules

1. **Team → Team**: Max concise, abbrevs, emojis, facts
2. **Team Lead → User**: Natural language, results
3. **No humanization**: No "Hello", "Thanks", "Great job"
4. **No celebrations**: No "Successfully", "Happy to report"
5. **No process exposition**: User doesn't see internal workflow
6. **Facts only**: What happened, what's next
7. **Token efficiency**: Every word counts in team messages

## Summary Template

### For issue-analyzer → team-lead
```
[emoji] #[issue] ana done
rpt: [path]
complexity: [simple|med|complex]
effort: [estimate]
[blockers if any]
```

### For implementer → team-lead
```
[emoji] #[issue] impl done
phpcs: [ok|nok]
phpunit: [ok|nok]
wrk: [path]
[issues if any]
```

### For reviewer → team-lead
```
[emoji] #[issue] review [pass|fail]
phpcs: [status]
phpunit: [status]
cov: [status]
[specific issues if fail]
```

### For process-improvement → team-lead
```
[emoji] [improvement type]
[what changed]
[impact]
```
