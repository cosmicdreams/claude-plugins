# Connectors

Workshop skills reach Slack, Gmail and Google Calendar through the host's connectors, the signed-in integrations the assistant's host provides as tools. They do not use a third-party command-line tool for these services. Jira (`twg`) and GitHub (`gh`) still use their own tools.

| Service | Connector tools used |
|---|---|
| Slack | `slack_search_channels`, `slack_read_channel`, `slack_read_thread`, `slack_search_public_and_private`, `slack_search_users`, `slack_send_message` |
| Gmail | `search_threads`, `get_thread`, `create_draft`, `send_message`, `reply` |
| Google Calendar | `list_calendars`, `list_events`, `suggest_time`, `create_event` |

Tool names carry a host prefix (for example `mcp__<connector>__slack_read_channel`), and a host may defer them. Find them with tool search before deciding a connector is missing.

## When a connector is missing

Say which connector the skill needs and that it is set up in the host's connector settings, then stop that part of the work. Do not fall back to a command-line tool, a personal token or a browser session, and do not report the source as quiet: a source that could not be read is a coverage gap.

## Which account

A connector acts as the account signed in to the host. Someone with separate work and personal accounts reaches work Slack, mail and calendar only from the host signed in with the work account. When the result looks like the wrong account (unknown channels, an empty calendar), say so instead of presenting it as the answer.

## Limits to state, not hide

- The Slack connector reaches one workspace per sign-in. Other configured workspaces are a coverage gap.
- The Slack connector does not expose unread state. Skills search for mentions and direct messages since a timestamp instead, and say that unread state was not available.
