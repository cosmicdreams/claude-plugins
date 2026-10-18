// Own the spawned process group: killing only the CLI leaves workers writing into a cleaned-up folder.
import { execFileSync, type ChildProcess } from 'node:child_process';

export const ownProcessGroup = process.platform !== 'win32';
const pause = (ms:number) => new Promise<void>((done)=>setTimeout(done,ms));
function signal(child:ChildProcess): void {
  if(child.pid === undefined)return;
  try {if(ownProcessGroup)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}
  catch(error) {if((error as NodeJS.ErrnoException).code !== 'ESRCH')throw error;}
}
function alive(child:ChildProcess): boolean {
  if(child.pid === undefined)return false;
  try {process.kill(ownProcessGroup?-child.pid:child.pid,0);return true;}
  catch(error) {
    if((error as NodeJS.ErrnoException).code === 'ESRCH')return false;
    if(ownProcessGroup && (error as NodeJS.ErrnoException).code === 'EPERM') {
      // macOS may refuse kill(group,0) after the reaped CLI ceases to be our child. Prove the
      // absence of live workers with the process table; EPERM alone never means cleanup is safe.
      let table:string;
      try {table=execFileSync('/bin/ps',['-axo','pid=,pgid=,stat='],{encoding:'utf8'});}
      catch(cause) {throw new Error(`process group ${child.pid} was signalled, but its termination could not be verified: kill(group,0) was refused and /bin/ps failed (${(cause as NodeJS.ErrnoException).code??String(cause)})`,{cause});}
      const rows=table.trim().split('\n');
      return rows.some((row)=>{const [,group,state]=row.trim().split(/\s+/);return Number(group)===child.pid && !state?.startsWith('Z');});
    }
    throw error;
  }
}
/** Terminate, reap the CLI, then wait boundedly for its workers before artifact cleanup. */
export async function stopProcessTree(child:ChildProcess): Promise<void> {
  const closed=child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>((done)=>child.once('close',()=>done()));
  signal(child);
  await closed;
  for(let i=0;i<100 && alive(child);i++) {signal(child);await pause(25);}
  if(alive(child))throw new Error(`process group ${child.pid} remained alive after termination`);
}
