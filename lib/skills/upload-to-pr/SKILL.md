---
name: upload-to-pr
description: >
  Attach a screenshot, recording, or other image or video to a GitHub pull request,
  issue, or comment with `gh --attach`, so the evidence renders inline. Use when a
  comment needs to show something rather than describe it. Not for posting text-only
  comments (lib:leave-pr-comment).
---

# lib:upload-to-pr

## When to use

Full routing detail, kept out of the always-loaded skill listing:

> Put an image or video into a GitHub pull request, issue, or comment body. Trigger phrases: "attach this screenshot", "upload the recording to the PR", "show the before and after in the comment", "post the failing screen to the issue". Do NOT trigger for text-only comments (lib:leave-pr-comment) or for committing assets that belong in the repository itself.

## The short version

`gh` uploads attachments natively as of version 2.99.0 (shipped 2026-09-01). Use
it — do not commit screenshots to a branch, publish gists, or drive the web
editor to work around a limitation that no longer exists.

```bash
gh pr comment <number> --attach './shots/login-error.png#Login form rejecting a valid password'
```

Verify the version first; anything older lacks the flag:

```bash
gh --version   # need >= 2.99.0
```

## Rules

Text after `#` is the alternate text. Always write it — it is the only
description a screen reader user gets, and it stays useful when an image fails
to load. Without it, `gh` falls back to the filename.

If the body already references the file, that reference is rewritten to point at
the uploaded asset:

```bash
gh pr comment 13 --body 'Before the fix: ![the crash](./before.png)' --attach './before.png#The crash'
```

Any attached file the body does not reference is appended to the end of the
body. Repeat the flag for more than one file, up to 50 per command:

```bash
gh pr comment 13 --attach ./before.png --attach ./after.png
```

Attachment support covers `gh pr create`, `gh pr edit`, `gh pr comment`,
`gh issue create`, `gh issue edit`, and `gh issue comment`. It does **not**
cover `gh pr review` — post a separate comment when a review needs an image.

## Limits

| Kind | Limit |
|------|-------|
| Images and animated GIFs | 10 megabytes |
| Video, free plan | 10 megabytes |
| Video, paid plans | 100 megabytes |

Uploaded assets inherit the repository's visibility, so an attachment on a
private repository stays private.

Over the limit? Shrink rather than reach for another host: `lib:image-optimize`
for stills, `lib:ffmpeg` for video. A trimmed clip or a compressed screenshot
reads better than a link to somewhere the reader has to authenticate again.

## Capturing the evidence first

- Browser state: `chrome-devtools-mcp:chrome-devtools` or the `playwright-cli`
  skill.
- Whole screen or a window on macOS: `screencapture -i /tmp/shot.png` for an
  interactive selection, `screencapture -R x,y,w,h /tmp/shot.png` for a region.
- Screen recording: `screencapture -v /tmp/clip.mov`, then trim with
  `lib:ffmpeg`.

Name the file after what it shows, not `Screenshot 2026-09-22 at 11.58.02 AM.png` —
the name ends up in the alternate text whenever you forget to write one.

## Fallbacks

Only if `gh` cannot be upgraded past 2.99.0:

1. **Commit the asset to the pull request branch** and link the `raw` URL. Works
   everywhere, but it puts binaries in the history and the link breaks when the
   branch is deleted after a squash merge.
2. **The `uploads.github.com/user-attachments/assets` endpoint** that the web
   editor itself calls. It is undocumented, has no published contract, and can
   change without notice — treat it as a last resort, not as an API.

Bitbucket, which the client repositories use, has no attachment API for pull
request comments at all. There, commit the asset or link it from a Jira issue.
