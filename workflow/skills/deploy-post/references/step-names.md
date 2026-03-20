# Deployment Step Names

| Name | Description |
|---|---|
| `develop` | Tested on develop |
| `staging` | Tested on staging |
| `backup` | Back up database |
| `approved` | Launch approved |
| `precheck` | Pre-deployment check |
| `email` | Email sent to client |
| `maint-on` | Put site in maintenance mode |
| `deploy` | Deploy staged code |
| `search` | Rebuild search index |
| `testing` | Manual testing |
| `maint-off` | Take site out of maintenance mode |
| `uat` | User acceptance |
| `merge-main` | Merge to main |
| `merge-develop` | Merge to develop |

## Aliases

`maintenance-on`, `maintenance-off`, `manual-test`, `acceptance`, `merge_main`, `merge_develop`

Prefix matching works when unambiguous: `maint` → `maint-on`.

## Initial icon states

- All steps: `:white_square:` (pending)
- `uat`: `:rocket:` (pending — signals the final gate)
