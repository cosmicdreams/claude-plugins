# Skill Validation Checklist

Use this checklist before uploading a skill. The `validate_skill.py` script automates the structural checks; this covers everything else.

## Before Starting

- [ ] Identified 2-3 concrete use cases
- [ ] Determined which tools are needed (built-in, MCP, scripts)
- [ ] Reviewed example skills for the chosen pattern
- [ ] Planned folder structure

## During Development

### Structure
- [ ] Folder named in kebab-case
- [ ] `SKILL.md` file exists (exact case)
- [ ] YAML frontmatter has `---` delimiters
- [ ] `name` field: kebab-case, no spaces, no capitals
- [ ] `name` matches folder name
- [ ] No `README.md` inside skill folder

### Description
- [ ] Description includes WHAT the skill does
- [ ] Description includes WHEN to use it (trigger phrases)
- [ ] Description under 1024 characters
- [ ] No XML angle brackets (`<` or `>`)
- [ ] Includes specific phrases users would say
- [ ] Negative triggers added if scope is narrow

### Instructions
- [ ] Written in imperative/infinitive form
- [ ] Instructions are specific and actionable
- [ ] Error handling included for common failures
- [ ] Examples provided with realistic user requests
- [ ] Bundled resources referenced explicitly
- [ ] No TODO placeholders remaining
- [ ] SKILL.md body under 5000 words

### Resources
- [ ] Unused example directories deleted
- [ ] Scripts are executable (`chmod +x`)
- [ ] References contain only needed documentation
- [ ] Large reference files include grep search patterns in SKILL.md

## Before Upload

- [ ] Tested triggering on obvious tasks
- [ ] Tested triggering on paraphrased requests
- [ ] Verified doesn't trigger on unrelated topics
- [ ] Functional tests pass
- [ ] Tool integration works (if applicable)
- [ ] Compressed as `.zip` file (for Claude.ai upload)

## After Upload

- [ ] Test in real conversations
- [ ] Monitor for under/over-triggering
- [ ] Collect user feedback
- [ ] Iterate on description and instructions
- [ ] Update version in metadata
