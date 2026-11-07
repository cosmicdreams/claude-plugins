import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { ownProcessGroup, stopProcessTree } from '../../src/process-tree.ts';

test('ownership cleanup stops the owned CLI and worker, while an unrelated process survives', async () => {
  const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: ownProcessGroup, stdio: 'ignore' });
  const owned = spawn(process.execPath, ['-e', "const {spawn}=require('node:child_process');const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(worker.pid);setInterval(()=>{},1000);"], { detached: ownProcessGroup, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const worker = await new Promise<number>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('owned worker did not start')), 5000);
      owned.stdout.once('data', data => { clearTimeout(timer); done(Number(data.toString().trim())); });
      owned.once('error', error => { clearTimeout(timer); reject(error); });
    });
    assert.ok(Number.isInteger(worker) && worker > 0);
    await stopProcessTree(owned);
    assert.ok(owned.signalCode !== null || owned.exitCode !== null);
    assert.ok(other.pid); assert.doesNotThrow(() => process.kill(other.pid!, 0), 'unrelated process must survive owned cleanup');
    if (ownProcessGroup) {
      let state = '';
      try { state = execFileSync('/bin/ps', ['-p', String(worker), '-o', 'stat='], { encoding: 'utf8' }).trim(); } catch { /* reaped */ }
      assert.ok(state === '' || state.startsWith('Z'), `owned worker ${worker} remains alive: ${state}`);
    }
    console.log('ownership probe: owned CLI/worker stopped; unrelated process survived');
  } finally { await stopProcessTree(owned); await stopProcessTree(other); }
});
