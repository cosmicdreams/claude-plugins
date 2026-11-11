# Connector and Error Handling

## Connector

The post is sent with the host's Slack connector (`slack_search_channels` to find the channel, `slack_send_message` to post). Tool names carry a host prefix and may be deferred; find them with tool search first. See `${CLAUDE_PLUGIN_ROOT}/references/connectors.md`.

If the session has no Slack connector, say so and that it is set up in the host's connector settings, then stop. Do not fall back to a command-line tool or a token. Offer the rendered post as text the user can paste.

The connector posts as the account signed in to the host, in that account's workspace. If `slack_search_channels` does not find the channel, the user may be signed in to a different workspace: say so and stop.

## Error handling

| Error | Action |
|---|---|
| No Slack connector | Say so, give the rendered post as text, stop |
| Channel not found | Verify the name with `slack_search_channels`; include `private_channel` in `channel_types` |
| Externally shared channel refused | The connector cannot post to Slack Connect channels; give the rendered post as text |
| Any other error | Show it and stop |
