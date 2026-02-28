# Iterative Retrieval Pattern

A 4-phase opt-in pattern for systematically finding relevant context when file paths are not pre-specified. Replaces ad-hoc searching with a structured approach that converges in bounded iterations.

## When to Use

**Invoke when:**
- The team-lead prompt says "find relevant context" rather than specifying file paths
- The card or issue does not identify which files to change
- You are working in an unfamiliar codebase with no prior analysis report

**Skip when:**
- The spawn prompt or card specifies exact file paths
- An analysis report already identifies the relevant files
- The task is scoped to a single, known file

## Decision Tree

```
Card specifies file paths?
  YES -> Skip. Start working.
  NO  -> Team-lead says "find relevant context"?
           YES -> Use iterative retrieval.
           NO  -> Is the target file obvious from the task description?
                    YES -> Skip. Start working.
                    NO  -> Use iterative retrieval.
```

## The 4 Phases

### Phase 1: Dispatch (broad search)

Cast a wide net using Glob and Grep to identify candidate files related to the task.

- Use Glob for structural discovery: `**/*.module`, `**/src/**/*.php`
- Use Grep for content discovery: search for keywords, function names, class names from the issue description
- Aim for 5-20 candidate files. If you get 50+, your query is too broad.

### Phase 2: Evaluate (score relevance)

Read the top candidates and score each for relevance to the task.

- Does this file contain the logic, data, or configuration you need to understand or change?
- Is this a definition site (where the thing is declared) or a usage site (where it is called)?
- Discard files that are tangentially related but not actionable.

### Phase 3: Refine (narrow search)

Based on what Phase 2 revealed, run more specific searches.

- Follow imports, class hierarchies, or hook implementations discovered in Phase 2
- Search for specific function names, config keys, or service IDs you found
- Target: narrow to 3-5 files that are directly relevant to the task

### Phase 4: Loop (repeat if needed)

If Phase 3 did not converge on sufficient context, repeat Phases 2-3 with the new information. **Maximum 3 iterations total.** If you have not converged after 3 iterations, work with what you have and note the gap.

## Worked Example

**Task:** "Fix the error handling in the batch processing module"

**Phase 1 (Dispatch):**
```
Glob: **/batch*.php, **/Batch*.php
Grep: "batch" in *.module files
Grep: "BatchProcess" in **/*.php
```
Result: 12 candidate files.

**Phase 2 (Evaluate):**
Read the 12 files. 4 are test files, 3 are unrelated (batch in a comment), 2 are service definitions, 3 contain batch processing logic.

**Phase 3 (Refine):**
The 3 logic files reference `BatchBuilder::process()`. Search for that class.
```
Grep: "class BatchBuilder" in **/*.php
```
Found the class in `core/lib/Drupal/Core/Batch/BatchBuilder.php`. Read it. The error handling is in `::handleException()` which delegates to `BatchStorage`.
```
Grep: "class BatchStorage" in **/*.php
```

**Result:** Converged on 5 files: `BatchBuilder.php`, `BatchStorage.php`, `batch.module`, and 2 related test files. Ready to implement.

## Anti-Patterns

- **Shotgun grep:** Running 10+ unrelated Grep queries hoping one hits. Use Phase 1 structure instead.
- **Reading everything:** Opening every file returned by Glob. Evaluate first, read selectively.
- **Ignoring the cap:** More than 3 Evaluate/Refine iterations means the task scope is unclear -- stop and ask for clarification.
- **Skipping Evaluate:** Going straight from Dispatch to implementation. You will miss context and make incorrect assumptions.
