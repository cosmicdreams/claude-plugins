---
name: issue-summary
description: >
  Write a short Drupal.org contribution comment (what was fixed, the proof, what was not
  checked) once the fix passes the worth-it gate, from the analysis report and the git
  diff. Run only after drupal-lab:validate-patch passes.
---

# Issue Summary

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Generate a drupal.org contribution comment summarizing what was fixed and how to verify it. Use after validation passes, when ready to post to drupal.org -- e.g. "write the issue summary", "generate the drupal.org comment", "write up the fix for posting", "prepare the contribution comment". Reads the analysis report and git diff to produce a structured summary. Do NOT use before validation -- run drupal-lab:validate-patch first.

Generate a drupal.org contribution comment that summarizes what was fixed and how to verify it. Run this after `reviewer` passes on a worktree.

## Input

Issue number. The worktree path is inferred as `./worktrees/{issue_number}/`.

## Workflow

### 1. Read Context

- Analysis report: `./analysis-reports/{issue_number}.md` — problem description and root cause
- Git diff: `git diff main` from inside the worktree — what actually changed
- Test files added or modified in the diff

### 2. Run the worth-it gate

Answer each in writing in the analysis report before drafting anything. Any "no" stops the comment; tell Chris what is missing instead.

1. **One problem.** The diff fixes the issue's problem and nothing else. Side findings go to Chris as possible new issues, not into the comment.
2. **Proven.** The root cause is shown by a test that fails on the base branch, a stack trace, or a reproduction. A guard or null check without that proof fails here: ask the reporter for a stack trace instead.
3. **Smallest.** The diff is the smallest fix for the cause and follows the approach the maintainer or earlier contributors agreed on.
4. **Asked for.** The comment answers the issue's open question or reports a result the maintainer needs. A status update with nothing new is not.
5. **Worth the reviewer's time.** A maintainer would clearly want to read it.

If the project is in `~/.claude/upstream-maintainers.json`, Chris posts in his own words: hand him the facts below and stop.

### 3. Write the comment

At most five sentences or 150 words, conclusion first, no headings:

- What the fix does, in one sentence, naming the cause.
- The proof, with its literal result: which test fails on the base branch and the failure message, then that it passes with the fix.
- How to verify by hand, only when a reviewer could not tell from the test: at most three steps.
- What was not checked.

Leave out a file list (the merge request shows it), alternative approaches, process narration ("I rebased, then I ran..."), and design essays. If the merge request needs a decision from the maintainer, ask it as one question.

## Output

The comment text, followed by the gate answers for Chris. Read the comment back and cut anything a maintainer would skip.

## Obsidian Storage

After the contribution comment is generated, also archive it to the Neurons vault. Obsidian is assumed to be running — if the write fails, run `obsidian help` to diagnose the connection.

### Project Mapping

Extract the Drupal project name from the issue URL or analysis report frontmatter:
- `https://www.drupal.org/project/drupal/issues/3345989` → project = `drupal`
- `https://www.drupal.org/project/webform/issues/3401234` → project = `webform`
- Drupal core issues use the `drupal` folder; contrib modules use the module's machine name.

### Vault Path

```
~/Vaults/Neurons/OpenSource/Drupal.org/<project>/<issue-number>-contribution-comment.md
```

Examples:
```
OpenSource/Drupal.org/drupal/3345989-contribution-comment.md
OpenSource/Drupal.org/webform/3401234-contribution-comment.md
```

### Archive Command

```bash
DRUPAL_PROJECT="<extracted-from-issue-url>"
ISSUE_NUMBER="<issue-number>"
VAULT_ROOT="$HOME/Vaults/${OBSIDIAN_VAULT_NAME:-Neurons}"
DEST_PATH="OpenSource/Drupal.org/${DRUPAL_PROJECT}/${ISSUE_NUMBER}-contribution-comment.md"

mkdir -p "$VAULT_ROOT/$(dirname "$DEST_PATH")"
cat > "$VAULT_ROOT/$DEST_PATH" << 'EOF'
<contribution-comment-content>
EOF
```

### YAML Frontmatter

Prepend the following frontmatter to the stored document (substitute actual values):

```yaml
---
drupal_project: drupal
issue_number: 3345989
date: 2026-03-07
tags: [drupal, contribution]
---
```

This preserves a record of what was submitted and when, enabling future reference and pattern analysis across contributions.
