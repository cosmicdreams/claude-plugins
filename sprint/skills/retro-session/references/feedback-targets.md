# Feedback Targets - Action Card Routing

Maps retrospective findings to specific targets where changes can be implemented.

**Purpose**: Each action card produced by the retrospective skill is routed to a target that specifies what can be changed and how.

---

## Target Types & Implementation Paths

### 1. **memory** — Update MEMORY.md
**What**: Session baselines, code learnings, process patterns, trend analysis
**File**: `/Users/Chris.Weber/.claude/projects/-Users-Chris-Weber-OpenSource-DRUPAL/memory/MEMORY.md`
**Process**: Edit existing file with new observations, update sections
**Approval**: Team lead reviews, user approves before edit
**Example**: "MEMORY: Add architectural pattern for entity field validation discovered this session"

---

### 2. **claude-md** — Update CLAUDE.md
**What**: Development practices, coding standards, architecture guidelines, testing requirements
**File**: `/Users/Chris.Weber/OpenSource/DRUPAL/CLAUDE.md`
**Process**: Add new sections or update existing guidance
**Approval**: Team lead reviews, user approves before edit
**Example**: "CLAUDE.md: Document Settings Tray jQuery→HTMX conversion pattern for future module work"

---

### 3. **agent** — Modify Agent Definition
**What**: Agent capabilities, constraints, responsibilities, tools access
**Directory**: `/Users/Chris.Weber/OpenSource/DRUPAL/.claude/agents/`
**Files**: Agent .md definition files
**Process**: Edit agent prompt, constraints, or role description
**Approval**: Team lead reviews, user approves before edit
**Example**: "agent: implementer - Add Drupal 11 API patterns to knowledge base section"

---

### 4. **skill** — Update or Create Skill
**What**: Skill procedures, phases, templates, error handling, references
**Directory**: `/Users/Chris.Weber/OpenSource/DRUPAL/.claude/skills/`
**Process**: Create new skill or update existing SKILL.md and references/
**Approval**: Team lead reviews, user approves before edit
**Example**: "skill: validate-patch - Add Phase 0 test design review before DDEV"

---

### 5. **protocol** — Create or Update Protocol
**What**: Standard procedures, decision frameworks, lifecycle management
**Directory**: `/Users/Chris.Weber/OpenSource/DRUPAL/.claude/protocols/`
**Files**: Protocol .md files (e.g., DDEV-CLEANUP.md, decision-framework.md)
**Process**: Document new protocol or update existing procedure
**Approval**: Team lead reviews, user approves before edit
**Example**: "protocol: Create JSONL-MINING.md - Standard grep patterns for retrospective analysis"

---

### 6. **standard** — Establish or Update Standard
**What**: Coding standards, naming conventions, file structure, commit messages
**Directory**: Project conventions, Drupal coding standards
**Process**: Document standard or update project guidelines
**Approval**: Team lead reviews, user approves before adoption
**Example**: "standard: Kanban card naming - Use pattern retro-YYYYMMDD-NNN for action cards"

---

### 7. **hook** — Add Continuous Data Capture
**What**: Automated monitoring, real-time metrics collection, session telemetry
**Directory**: `.claude/hooks/` (Phase 2 only)
**Status**: ⏸️ **DEFERRED PHASE 2** — Currently no hooks used; grep-level JSONL mining sufficient
**Future**: Only add if retrospectives reveal genuine data gaps
**Example**: "hook: session-event-logger - Capture test failures in real-time (Phase 2 decision)"

---

### 8. **future** — Capture Aspirational Improvement
**What**: Long-term architectural changes, major refactoring, new capabilities
**Status**: No immediate implementation; document for future roadmap
**Process**: Catalog as research item or design discussion for future sessions
**Approval**: Team lead acknowledges and prioritizes for future work
**Example**: "future: Implement automated JSONL semantic labeling to replace grep-level analysis (3-6 month roadmap)"

---

## Routing Decision Tree

When categorizing a finding:

1. **Is it a metric/learning/pattern to preserve?** → **memory**
2. **Is it a coding practice or architecture decision?** → **claude-md** or **skill**
3. **Is it a change to how agents work?** → **agent**
4. **Is it a process/workflow procedure?** → **protocol** or **skill**
5. **Is it a structural guideline (naming, file layout)?** → **standard**
6. **Is it monitoring/telemetry?** → **hook** (deferred) or **protocol**
7. **Is it aspirational/long-term?** → **future**

---

## Multi-Target Cards

Some action items may span multiple targets. Example:

**Finding**: "Cross-worktree DDEV cleanup gaps cause validator slow-start"

**Could route to**:
- **protocol**: Update DDEV-CLEANUP.md with explicit multi-worktree cleanup steps
- **skill**: Add step to process-lifecycle skill checking for orphaned DDEV instances
- **memory**: Document pattern for future reference

**Card status**: One card may generate multiple implementation tasks, tracked separately.

---

## Examples by Category

### KEEP DOING Cards
- Target: **memory**, **skill**, **claude-md**
- Example: "Keep the tight test-fix-validate loop; it provides fast feedback"
- Implementation: Document in MEMORY.md, reference in validate-patch skill, note in CLAUDE.md best practices

### IMPROVE Cards
- Target: **skill**, **protocol**, **agent**, **standard**
- Example: "Reduce DDEV startup time for validators via cached instances"
- Implementation: Create/update protocol, potentially modify skill phases

### LEARN Cards
- Target: **memory**, **claude-md**, **agent**
- Example: "Entity field validation patterns in Drupal 11 core"
- Implementation: Capture technical knowledge in MEMORY.md, update agent context

---

## Phase 2 Targets (Deferred)

### **hook** (Continuous Capture)
Currently deferred. Will reconsider after Phase 1 retrospectives show whether grep-level JSONL mining is insufficient.

**Future hook categories** (if/when Phase 2 approved):
- Session event logging (test start/end, error occurrence)
- Agent state transitions (idle → working → waiting)
- Resource utilization (DDEV CPU/memory, token usage)
- Tool call patterns (which tools used by which agents, timing)

---

## Notes

- **No direct execution**: Retrospective skill proposes cards; user approves changes before implementation
- **Institutional memory**: Rejected cards archived with reasons; future retrospectives check history
- **Cross-session tracking**: Target-based organization enables trend analysis (e.g., "How many IMPROVE cards target skills vs. protocols?")
