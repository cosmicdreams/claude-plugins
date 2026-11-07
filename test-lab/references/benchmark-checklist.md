# Benchmark checklist

Vet a performance number before you report it or act on it: a pull request's before and after, a regression claim, an experiment harness, or a choice between libraries or settings. Answer each question with evidence from a run, not a guess about the code.

Adapted from pstack's `benchmark-checklist` and `principle-explain-the-number` (Lauren Tan, MIT, cursor/plugins).

For a quick ballpark the user asked for, one run is enough. Still answer questions 4 and 7, and say it is one run. A choice between options is never a ballpark.

## Before you run anything

- Write the claim you expect to make, in the words you would ship ("the listing page is 30% faster at the median on the 60,000-node dataset"). The questions test that sentence.
- Read the measurement script. Note what it times, counts and ignores.
- Record the load average (`uptime`) and the core count (`sysctl -n hw.ncpu` on macOS, `nproc` on Linux) in the notes. If the machine is busy, find out what is running. If you cannot stop it, alternate the sides so both see the same noise, and say so in the report.

## The questions

1. **Why not double?** Name the limiter: the core, lock, disk, network, database or load generator that bounds the result. Get it from a profile or system counters taken in a run you do not report, then map it to source. If the load generator saturates first, you measured the load generator.
2. **Was it tuned?** Run every side the way production runs it: same build, flags, caches, versions and data. If one side runs on defaults, you compared configurations, not implementations. Tune it and measure again before picking a winner.
3. **Did it break limits?** Do the arithmetic. Removing a piece that takes 10% of the run can make the run at most about 11% faster. A result past a limit measured something else: a cache, a no-op or a bug.
4. **Did it error?** Count failures and non-success responses, and check outputs are correct, not just present. Rejections are fast, and timeouts and retries are slow. If the script does not count errors, add the count.
5. **Does it reproduce?** Run each side at least 5 times, alternating (A, B, A, B) so warmup and drift favor neither. Report the median and range. Never mix single samples with medians or means in one comparison. A gap smaller than the run-to-run spread is no measurable difference.
6. **Does it matter?** Next to any small result, measure the end-to-end path a user waits on and report the small result as a share of it.
7. **Did it even happen?** Confirm the work ran inside the timed region: the request reached the server, the rows were written, the code used the result. Cached pages, lazy code and timeouts produce numbers for work that never happened.

## Report

- Lead with the verdict: faster, slower, no measurable difference, or inconclusive.
- Give the number with its unit, the run count, the range and the limiter, plus the error count and how you confirmed the work happened. For example, "median 410 ms → 330 ms, 7 alternating runs per side, range 320 to 350 ms after, bound by database queries; 0 errors; responses checked for the expected markup".
- Call it inconclusive when you claim a difference but cannot name the limiter, when one side ran untuned, when the load average was above the core count, or when you could not answer questions 4 and 7. Name the gap.
