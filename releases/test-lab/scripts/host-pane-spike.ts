#!/usr/bin/env node
// Live terminal pane spike (plan §14 phase 0): the installed Claude Code, interactive, in a private tmux
// server started for this spike, with the mod loaded by the documented `--plugin-dir` transient load. The
// model calls the `verdict` tool on a Ready run the staged runner made; the spike reads the terminal and
// checks that the test-lab pane is drawn with the verdict and its actions. Then it edits the staged mod,
// types `/reload-plugins`, asks again and checks the pane draws through the rebuilt module.
//
//   node scripts/host-pane-spike.ts [--model haiku] [--keep]
//
// Screen captures go to the log (the terminal shows paths under temporary folders, no secrets). The
// tmux server, its session, the fixture and the staged plugin are removed at the end.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clip, prepareSpike, spikeLog } from './spike-fixture.ts';

const args = process.argv.slice(2);
const model = args.includes('--model') ? args[args.indexOf('--model') + 1]! : 'haiku';
const keep = args.includes('--keep');
const { path: log, note, check, state } = spikeLog('host-pane-spike');
const session = 'spike';
let socket = '';
const tmux = (...a: string[]) => execFileSync('tmux', ['-S', socket, ...a], { encoding: 'utf8' });
const screen = () => tmux('capture-pane', '-p', '-t', session, '-S', '-80');
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** The docked pane's column: what each screen row draws right of the frame, never the transcript. */
const paneColumn = (text: string) => text.split('\n').map((l) => (l.includes('│') ? l.slice(l.lastIndexOf('│') + 1).trim() : '')).filter(Boolean).join('\n');
async function waitFor(label: string, test: (text: string) => boolean, ms: number, answer?: (text: string) => void): Promise<string> {
  const end = Date.now() + ms;
  let text = '';
  while (Date.now() < end) {
    text = screen();
    if (test(text)) return text;
    answer?.(text);
    await pause(500);
  }
  note({ timeout: label, screen: clip(text, 6000) });
  throw new Error(`timed out waiting for ${label}`);
}
const started = Date.now();
const { f, staged, data, readyDir, directExit, cleanup } = await prepareSpike();
// The tmux socket lives in the spike's data folder, so cleanup removes it with everything else.
socket = join(data, 'tmux.sock');

try {
  check('the staged runner made a Ready run outside the host', directExit === 0 && readyDir !== null, { exit: directExit, runDir: readyDir });
  const command = ['claude', '--plugin-dir', staged, '--model', model, '--allowedTools', 'mcp__test-lab__verdict'];
  note({ command, cwd: f.suite, tmux: { socket, columns: 220, rows: 60 }, testLabData: data });
  tmux('new-session', '-d', '-s', session, '-x', '220', '-y', '60', '-c', f.suite, '-e', `TEST_LAB_DATA=${data}`, ...command);
  // First start in a new folder: the workspace trust question, then the prompt.
  // The default answer is "No, exit"; trusting the disposable fixture folder is the second choice. Keys
  // are sent by what the dialog shows selected, since it may draw before it takes input.
  let asked = false;
  const ready = await waitFor('the prompt', (t) => /❯/.test(t) && !/trust this folder/i.test(t), 90_000, (t) => {
    if (!/trust this folder/i.test(t)) return;
    if (!asked) {
      asked = true;
      note({ trustQuestion: clip(t.split('\n').filter((l) => /trust|Yes|No/i.test(l)).join('\n'), 800) });
    }
    if (/❯ No, exit/.test(t)) tmux('send-keys', '-t', session, 'Down');
    else if (/❯ Yes, I trust this folder/.test(t)) tmux('send-keys', '-t', session, 'Enter');
  });
  note({ step: 'started', screen: clip(ready, 4000) });
  const ask = `Call the tool mcp__test-lab__verdict exactly once with runDir ${readyDir}. Do not call any other tool. Then say done.`;
  tmux('send-keys', '-t', session, '-l', ask);
  await pause(300);
  tmux('send-keys', '-t', session, 'Enter');
  const shown = await waitFor('the pane verdict', (t) => /^READY \(rule 8\)$/m.test(paneColumn(t)), 180_000);
  const pane = paneColumn(shown);
  note({ step: 'pane', screen: clip(shown, 8000), pane: clip(pane, 3000) });
  check('the terminal draws the test-lab pane with the Ready verdict', /^READY \(rule 8\)$/m.test(pane) && /^No failures seen$/m.test(pane), clip(pane, 300));
  check('the pane offers Open report on the machine that ran the tests', /Open report/.test(pane));
  check('the pane offers Copy summary', /Copy summary/.test(pane));
  // The person's keys: ctrl+x tab gives the pane the keyboard, then a Button's hotkey presses it. Both
  // actions run a host command through $.process.run; what follows is recorded as observed.
  for (const [key, label, answer] of [['c', 'Copy summary', /test-lab: (summary copied|could not copy the summary[^\n│]*)/], ['o', 'Open report', /test-lab: could not open the report[^\n│]*/]] as const) {
    tmux('send-keys', '-t', session, 'C-x');
    tmux('send-keys', '-t', session, 'Tab');
    await pause(500);
    tmux('send-keys', '-t', session, key);
    let seen = '';
    try {
      seen = await waitFor(`the ${label} answer`, (t) => answer.test(t), 10_000);
    } catch {
      seen = screen();
    }
    const toast = answer.exec(seen)?.[0]?.trim() ?? 'no toast within 10s (for Open report, no error toast means the opener exited 0)';
    note({ step: `press ${label}`, toast, rows: seen.split('\n').filter((l) => /could not|copied/.test(l)).map((l) => l.trim()) });
    console.log(`note ${label} pressed through the pane: ${toast}`);
    tmux('send-keys', '-t', session, 'Escape');
    await pause(500);
  }

  const model_ts = join(staged, 'hooks/mod/model.ts');
  writeFileSync(model_ts, readFileSync(model_ts, 'utf8').replace("ready: 'READY',", "ready: 'READY (rebuilt)',"));
  // Saving a module of a --plugin-dir mod hot-reloads it in an interactive session; record whether it did.
  let hot = '';
  try {
    hot = await waitFor('a hot reload on save', (t) => /test-lab: reloaded/.test(t), 20_000);
  } catch {
    hot = '';
  }
  note({ step: 'hot reload on save', seen: hot === '' ? null : clip(hot.split('\n').filter((l) => /test-lab: reloaded/.test(l)).join('\n'), 400), paneRebuilt: /^READY \(rebuilt\) \(rule 8\)$/m.test(paneColumn(hot)) });
  console.log(`note hot reload on save: ${hot === '' ? 'not seen within 20s' : 'seen'}`);
  tmux('send-keys', '-t', session, '-l', '/reload-plugins');
  await pause(300);
  tmux('send-keys', '-t', session, 'Enter');
  const reloaded = await waitFor('the reload answer', (t) => /Reloaded:/.test(t), 60_000);
  note({ step: 'reload', screen: clip(reloaded.split('\n').filter((l) => /Reload|error|plugin/i.test(l)).join('\n'), 1500) });
  tmux('send-keys', '-t', session, '-l', `Call mcp__test-lab__verdict once more with runDir ${readyDir}, then say done.`);
  await pause(300);
  tmux('send-keys', '-t', session, 'Enter');
  const rebuilt = await waitFor('the rebuilt pane', (t) => /^READY \(rebuilt\) \(rule 8\)$/m.test(paneColumn(t)) && /done/i.test(t.split('Call mcp__test-lab__verdict once more').at(-1) ?? ''), 180_000);
  note({ step: 'rebuilt', screen: clip(rebuilt, 8000), pane: clip(paneColumn(rebuilt), 3000) });
  check('after the edit and reload, the pane draws through the rebuilt module', /^READY \(rebuilt\) \(rule 8\)$/m.test(paneColumn(rebuilt)));
  tmux('send-keys', '-t', session, '-l', '/exit');
  await pause(300);
  tmux('send-keys', '-t', session, 'Enter');
  await pause(3_000);
  note({ summary: { failed: state.failed, seconds: Math.round((Date.now() - started) / 1000) } });
  console.log(`log: ${log}\nruntime: ${Math.round((Date.now() - started) / 1000)}s`);
} catch (error) {
  state.failed = true;
  note({ error: clip(error instanceof Error ? error.message : error, 800) });
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}\nlog: ${log}`);
} finally {
  try {
    tmux('kill-server');
  } catch {
    // Already gone with its last session.
  }
  await cleanup(keep);
}
process.exitCode = state.failed ? 1 : 0;
