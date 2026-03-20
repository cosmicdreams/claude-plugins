# Config Updates Mid-Session

Update the active config file in place (whichever was loaded in Step 1).

- "add #javascript to Velir" → append to that workspace's `channels`
- "remove #preview from Velir" → remove from that workspace's `channels`
- "add keyword 'deploy' to Velir" → append to that workspace's `keywords`

Confirm after each change:
"Updated. [WorkspaceName] now tracks: #ch1, #ch2, #ch3"

## Running on a loop

```
/loop 1h /workflow:pulse
```

Cancel with `CronDelete` using the job ID returned by `/loop`.
