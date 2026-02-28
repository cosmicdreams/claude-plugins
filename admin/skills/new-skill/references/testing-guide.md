# Testing Skills

Skills can be tested at three levels of rigor. Choose based on audience size and quality requirements.

## Level 1: Triggering Tests

**Goal**: Ensure the skill loads at the right times.

### Test Cases

Create two lists:

**Should trigger:**
- Obvious requests: "Help me set up a new ProjectHub workspace"
- Paraphrased requests: "I need to create a project in ProjectHub"
- Variant phrasing: "Initialize a ProjectHub project for Q4 planning"

**Should NOT trigger:**
- Unrelated topics: "What's the weather?"
- Adjacent but out-of-scope: "Help me write Python code"
- Similar but different skill: "Create a spreadsheet" (if skill only handles projects)

### Measurement

Run 10-20 test queries. Track how many times the skill loads automatically vs. requires explicit invocation. Target: 90% correct triggering on relevant queries.

### Fixing Trigger Issues

| Problem | Solution |
|---|---|
| Under-triggering | Add more trigger phrases, keywords, and file types to description |
| Over-triggering | Add negative triggers ("Do NOT use for..."), narrow scope |
| Wrong skill triggers | Clarify scope boundaries between overlapping skills |

## Level 2: Functional Tests

**Goal**: Verify the skill produces correct outputs.

### Test Cases

- Valid outputs generated for standard inputs
- API/tool calls succeed
- Error handling activates for invalid inputs
- Edge cases produce reasonable results

### Example

```
Test: Create project with 5 tasks
Given: Project name "Q4 Planning", 5 task descriptions
When: Skill executes workflow
Then:
  - Project created successfully
  - 5 tasks created with correct properties
  - All tasks linked to project
  - No API errors
```

### Scripted Testing (Claude Code)

Automate test cases for repeatable validation:

1. Create a test conversation with known inputs
2. Run the skill
3. Verify outputs match expectations
4. Repeat across changes

## Level 3: Performance Comparison

**Goal**: Prove the skill improves results vs. baseline (no skill).

### Baseline Metrics

| Metric | Without Skill | With Skill |
|---|---|---|
| Back-and-forth messages | 15 | 2 |
| Failed API calls | 3 | 0 |
| Total tokens consumed | 12,000 | 6,000 |
| User corrections needed | Multiple | None |

### Qualitative Checks

- Users don't need to prompt Claude about next steps
- Workflows complete without user correction
- Consistent results across sessions
- A new user can accomplish the task on first try

## Iteration Workflow

1. Use the skill on real tasks
2. Notice struggles or inefficiencies
3. Identify which part of SKILL.md or resources needs updating
4. Implement changes
5. Re-test triggering and function
6. Repeat

### Pro Tip

Iterate on a single challenging task until Claude succeeds, then extract the winning approach into the skill. This leverages in-context learning and provides faster signal than broad testing.
