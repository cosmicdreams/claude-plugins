# admin:install — Reactive Install: csv-analysis Fix

## Request
"I tried to run lib:csv-analysis but got 'ModuleNotFoundError: No module named pandas'. Fix this."

## Skill Behavior

1. **Identified the skill**: lib:csv-analysis (from the error context)
2. **Looked up full prereqs** (not just pandas): pandas, matplotlib, seaborn
3. **Detected environment**: Linux sandbox → use `pip install --break-system-packages`
4. **Installed all three packages** in one batch:
   ```bash
   pip3 install pandas matplotlib seaborn --break-system-packages
   ```
5. **Verified all imports work**:
   ```
   ✓ pandas 2.3.3
   ✓ matplotlib 3.10.8
   ✓ seaborn 0.13.2
   ```
6. **Confirmed**: csv-analysis is ready to use.

## Evaluation Notes

- ✓ Correctly identified lib:csv-analysis from the error message
- ✓ Installed ALL prereqs (pandas + matplotlib + seaborn), not just the one that errored
- ✓ Used `--break-system-packages` flag for Linux sandbox
- ✓ Verified imports after install
- ✓ No unnecessary packages installed (didn't pull in agent-slack, gh, etc.)
- ✓ No auth step needed (pip packages don't require auth)
- ✓ Concise output — didn't dump the full bootstrap report, just fixed the issue

## What the user would see

```
Detected: Linux sandbox (Ubuntu 22.04)
Skill: lib:csv-analysis
Missing: pandas (+ matplotlib, seaborn for complete prereqs)

Installing...
✓ pandas 2.3.3       installed
✓ matplotlib 3.10.8  installed
✓ seaborn 0.13.2     installed

csv-analysis is ready. You can retry your task now.
```
