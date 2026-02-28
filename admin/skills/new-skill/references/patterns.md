# Skill Architecture Patterns

Five common patterns for structuring skill instructions. Most skills use one primary pattern, sometimes combining elements from others.

## Pattern 1: Sequential Workflow Orchestration

**Use when**: Users need multi-step processes in a specific order.

```markdown
## Workflow: Onboard New Customer

### Step 1: Create Account
Call tool: `create_customer`
Parameters: name, email, company

### Step 2: Setup Payment
Call tool: `setup_payment_method`
Wait for: payment method verification

### Step 3: Create Subscription
Call tool: `create_subscription`
Parameters: plan_id, customer_id (from Step 1)
```

**Key techniques**: Explicit step ordering, dependencies between steps, validation at each stage, rollback instructions for failures.

## Pattern 2: Multi-Source Coordination

**Use when**: Workflows span multiple services or data sources.

```markdown
### Phase 1: Design Export (Figma)
1. Export design assets
2. Generate specifications
3. Create asset manifest

### Phase 2: Asset Storage (Drive)
1. Create project folder
2. Upload all assets
3. Generate shareable links

### Phase 3: Task Creation (Linear)
1. Create development tasks
2. Attach asset links to tasks
```

**Key techniques**: Clear phase separation, data passing between phases, validation before moving to next phase.

## Pattern 3: Iterative Refinement

**Use when**: Output quality improves with iteration.

```markdown
### Initial Draft
1. Fetch data
2. Generate first draft
3. Save to temporary file

### Quality Check
1. Run validation: `scripts/check_report.py`
2. Identify issues (missing sections, formatting, data errors)

### Refinement Loop
1. Address each identified issue
2. Regenerate affected sections
3. Re-validate
4. Repeat until quality threshold met
```

**Key techniques**: Explicit quality criteria, validation scripts, know when to stop iterating.

## Pattern 4: Context-Aware Tool Selection

**Use when**: Same outcome, different approach depending on context.

```markdown
## Smart File Storage

### Decision Tree
1. Check file type and size
2. Determine best storage location:
   - Large files (>10MB): cloud storage
   - Collaborative docs: shared docs platform
   - Code files: version control
   - Temporary files: local storage

### Execute Storage
Based on decision:
- Call appropriate tool
- Apply service-specific metadata
- Generate access link

### Provide Context to User
Explain why that storage was chosen.
```

**Key techniques**: Clear decision criteria, fallback options, transparency about choices.

## Pattern 5: Domain-Specific Intelligence

**Use when**: The skill adds specialized knowledge beyond tool access.

```markdown
## Payment Processing with Compliance

### Before Processing (Compliance Check)
1. Fetch transaction details
2. Apply compliance rules:
   - Check sanctions lists
   - Verify jurisdiction allowances
   - Assess risk level
3. Document compliance decision

### Processing
IF compliance passed:
- Process transaction
- Apply fraud checks
ELSE:
- Flag for review
- Create compliance case

### Audit Trail
- Log all compliance checks
- Record processing decisions
```

**Key techniques**: Domain expertise embedded in logic, checks before action, comprehensive documentation.

## Choosing a Pattern

| If your skill... | Use Pattern |
|---|---|
| Has clear step-by-step procedures | 1: Sequential Workflow |
| Coordinates multiple services | 2: Multi-Source Coordination |
| Needs quality iteration | 3: Iterative Refinement |
| Adapts behavior to context | 4: Context-Aware Selection |
| Embeds specialized knowledge | 5: Domain-Specific Intelligence |

Most production skills combine patterns. For example: Sequential Workflow (primary) + Iterative Refinement (for quality gates) + Domain-Specific Intelligence (for validation rules).
