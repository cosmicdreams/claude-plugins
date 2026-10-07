import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadYaml} from '../../src/discovery-io.ts';
import {writeJson} from '../../src/contracts.ts';
const temp=()=>mkdtempSync('/tmp/design-lab-yaml-');
test('finding 3: PyYAML scalar and integer output semantics',()=>{const root=temp(),path=join(root,'props.yml');writeFileSync(path,'default: y\nenum: [y, n, 1e3, 1.0e3, 1.0e+3, 012, 0xFF, 1:02, 9007199254740993]\n');const value=loadYaml(path);assert.equal(value.default,'y');assert.deepEqual(value.enum.slice(0,-1),['y','n','1e3','1.0e3',1000,10,255,62]);writeJson(join(root,'out.json'),value);assert.match(readFileSync(join(root,'out.json'),'utf8'),/9007199254740993/);});
