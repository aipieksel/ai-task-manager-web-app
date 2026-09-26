# Task System Helpers

Use `create-plan-folder.py` to create a canonical TaskManager plan folder with `plan.json`, the twelve section files, the ordered `sections` manifest, and `codexEndGoal`.

Example:

```bash
python3 docs/tasks/task-system-helpers/create-plan-folder.py \
  --project-root . \
  --title "Global Styles Typography Sets" \
  --codex-end-goal "Ensure the global styles typography-set workflow produces the approved typography outcome across every in-scope style control and preview. If any in-scope typography set cannot be configured, previewed, and persisted as approved, the goal is not complete."
```

The goal should be concise and outcome-level, not a copied checklist.
