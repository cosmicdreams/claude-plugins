---
name: csv-analysis
description: >
  Analyze a CSV with pandas, matplotlib, and seaborn and return statistics, charts, and
  insights. Starts immediately without asking what the user wants. CSV only — not Excel,
  JSON, or SQL.
---

# lib:csv-analysis

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Automatically analyzes CSV files and generates comprehensive statistical summaries, visualizations, and actionable insights using Python's data science stack (pandas, matplotlib, seaborn). Triggers immediately without asking what the user wants. Use when the user uploads or references a CSV file, asks to "analyze this data", "summarize this CSV", "what's in this file", "visualize this data", or similar. Do NOT trigger for non-CSV tabular formats (use appropriate tools for Excel/JSON/SQL).

**Act immediately.** Do not ask the user what they want. Do not offer options. Load
the CSV and run a full analysis autonomously — the right analyses emerge from the data.

## Dependencies

Requires Python ≥ 3.8 with:
- `pandas` ≥ 2.0.0
- `matplotlib` ≥ 3.7.0
- `seaborn` ≥ 0.12.0

Install if missing: `pip install pandas matplotlib seaborn`

## Analysis Process

### Step 1 — Load and inspect

```python
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import sys, os

df = pd.read_csv("path/to/file.csv")

print(f"Shape: {df.shape[0]} rows × {df.shape[1]} columns")
print(f"\nColumn types:\n{df.dtypes}")
print(f"\nMissing values:\n{df.isnull().sum()}")
print(f"\nFirst 5 rows:\n{df.head()}")
```

### Step 2 — Determine data type

Inspect columns and infer context:

| Signal | Likely type | Analysis approach |
|---|---|---|
| Date/time column + numeric values | Time series | Trend lines, seasonality, rolling averages |
| Categorical + numeric | Grouped analysis | Bar charts, box plots, group aggregates |
| Many numeric columns | Statistical / financial | Correlation heatmap, distributions, outliers |
| ID + event columns | Transaction / log | Frequency analysis, funnel, top-N |
| Geographic columns | Spatial | Aggregation by region |

### Step 3 — Run type-appropriate analysis

**Always generate:**
- Row/column counts, data types, null counts
- Descriptive stats (`df.describe()`) for all numeric columns
- Top value frequencies for categorical columns (up to 10 unique values)
- Missing data percentage per column

**Generate only when relevant:**
- Time-series plot → only if a date/datetime column exists
- Correlation heatmap → only if 3+ numeric columns exist
- Distribution plots → for continuous numeric columns with variance
- Bar/count plots → for low-cardinality categorical columns
- Box plots → when comparing a numeric across a categorical

### Step 4 — Save visualizations

```python
# Always save, never just plt.show()
output_dir = os.path.dirname(os.path.abspath("path/to/file.csv"))
base_name = os.path.splitext(os.path.basename("path/to/file.csv"))[0]

# Example: save correlation heatmap
plt.figure(figsize=(10, 8))
sns.heatmap(df.select_dtypes(include='number').corr(), annot=True, fmt='.2f', cmap='coolwarm')
plt.title('Correlation Matrix')
plt.tight_layout()
plt.savefig(f"{output_dir}/{base_name}-correlation.png", dpi=150)
plt.close()
```

Name files: `<base-csv-name>-<chart-type>.png` in the same directory as the CSV.

### Step 5 — Report insights

After analysis, output a structured summary:

```
📊 CSV Analysis: filename.csv
─────────────────────────────────────
Shape:    1,234 rows × 8 columns
Nulls:    revenue (12%), category (0%)
Types:    4 numeric, 3 categorical, 1 datetime

KEY FINDINGS
• [Most important pattern or outlier]
• [Second finding]
• [Third finding]

STATISTICS (numeric columns)
  revenue:    mean $4,230  |  median $2,100  |  range $50–$98,000
  quantity:   mean 14.2    |  median 12      |  stddev 8.3

TOP CATEGORIES
  region:     West 38%  |  East 29%  |  South 19%  |  Other 14%

VISUALIZATIONS SAVED
  → filename-distribution.png
  → filename-correlation.png
─────────────────────────────────────
```

## Behavioral Rules

- **Never ask** "What would you like to analyze?" — determine it from the data
- **Never say** "I can create X if you want" — just create it
- **Always preserve** the original CSV (write outputs alongside, never overwrite)
- **Always report** the save path of each visualization
- **Skip charts** that would be meaningless for the data shape (e.g., no heatmap for 1 numeric column)
- **Handle encoding errors** gracefully: try `utf-8`, fall back to `latin-1`

## Error Handling

| Problem | Response |
|---|---|
| File not found | Ask user to confirm path, check working directory |
| Encoding error | Retry with `encoding='latin-1'` |
| pandas/matplotlib not installed | Show install command, stop |
| All-null column | Include in report as "empty column", skip from charts |
| Single-row CSV | Report it, skip statistical analysis |
