# Evaluate: Python vs Node for drover monitoring pipeline

## Status: Shelved

Not blocking current work. Revisit when the pipeline is stable and demo-ready.

## Context

Drover's monitoring pipeline is Python (fingerprint.py, ddev-watch.py, acquia-watch.py, acquia_api.py, acquia_logstream.py). The dashboard is Node. This split means two runtimes, two dependency chains, and the `websockets` pip package exists solely because Python lacks native WSS.

Node has built-in WebSocket (global since Node 22, `ws` package for older). If the pipeline were Node, the `websockets` dependency disappears and the dashboard + monitors share one runtime.

## Questions to answer

1. What does the Python side do that Node can't trivially do? (fingerprinting, regex normalization, state file management)
2. What does porting cost vs. maintaining two runtimes long-term?
3. Does the existing test suite (bats + python) constrain the choice?
4. Performance: does it matter at drover's throughput (~100 lines/30s)?
5. Would a single runtime simplify onboarding for colleagues?

## Decision criteria

- Fewer prerequisites for new users
- Less code to maintain
- No regression in fingerprint quality or test coverage
- Reasonable migration effort (< 1 day)
