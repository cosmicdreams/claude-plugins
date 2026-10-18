// Node 24 preload for each owned Playwright process, before config/spec evaluation. This is an
// invocation protocol, not a host/guard hook. Only explicitly declared nonsecret names are observed.
const { mkdirSync, openSync, closeSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const { parseRequest, bindingsOf, sameBindings, ENVIRONMENT_INPUTS_ENV, ENVIRONMENT_INPUTS_DIR } = require('./environment-inputs.ts');
const { isMainThread } = require('node:worker_threads');
const text = process.env[ENVIRONMENT_INPUTS_ENV];
const installed = Symbol.for('test-lab.environment-preload');
if (text !== undefined && isMainThread && !globalThis[installed]) {
  globalThis[installed] = true;
  const request = parseRequest(text);
  const output = process.env.TEST_LAB_STEP_OUTPUT;
  if (!output) throw new Error('environment invocation requires a reporter output');
  const original = process.env;
  const values = Object.fromEntries(request.declarations.map(d => [d.name, original[d.name] === undefined ? { state:'unset' } : { state:'set',value:original[d.name] }]));
  const state = { pid:process.pid, bindings:bindingsOf(request.declarations,values), changed:[], closed:false };
  const expected = bindingsOf(request.declarations, request.values);
  for (const d of request.declarations) if (!sameBindings(state.bindings.filter(b=>b.name===d.name),expected.filter(b=>b.name===d.name))) state.changed.push(d.name);
  const dir = join(dirname(output),ENVIRONMENT_INPUTS_DIR,request.invocation);
  mkdirSync(dir,{recursive:true});
  const file = join(dir,`${process.pid}.json`);
  closeSync(openSync(file,'wx'));
  const save = () => writeFileSync(file,JSON.stringify(state)+'\n');
  const names = new Set(request.declarations.map(d=>d.name));
  const changed = name => { if (typeof name==='string' && names.has(name) && !state.changed.includes(name)) {state.changed.push(name);save();} };
  // Writes invalidate even if later restored; no unexpected value is persisted. Direct reads and
  // imports/aliases share Node's environment object. Unsupported acquisition remains an AST refusal.
  process.env = new Proxy(original, {
    get(target,name) {
      const value=Reflect.get(target,name);
      if (typeof name==='string' && names.has(name)) {
        const expected=values[name];
        if (expected.state==='unset' ? value!==undefined : value!==expected.value) changed(name);
      }
      return value;
    },
    set(target,name,value) {changed(name);return Reflect.set(target,name,value);},
    deleteProperty(target,name) {changed(name);return Reflect.deleteProperty(target,name);},
    defineProperty(target,name,descriptor) {changed(name);return Reflect.defineProperty(target,name,descriptor);},
  });
  syncBuiltinESMExports();
  save();
  process.on('exit',()=>{state.closed=true;save();});
}
