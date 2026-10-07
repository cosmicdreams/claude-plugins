#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {oracleExecutable,oracleScript} from './oracle.ts';
const [name,...args]=process.argv.slice(2);if(!name)throw new Error('pass an adapter name');const result=spawnSync(oracleExecutable,[oracleScript(name+'.py'),...args],{env:process.env,stdio:'inherit'});process.exitCode=result.status??1;
