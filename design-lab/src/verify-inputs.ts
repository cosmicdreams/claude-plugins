/** Read-only, typed adapters for merged Figma verification inputs. Missing dumps are allowed. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import type { Component } from './build-artifacts.ts';
import type { RootDump, PageDump, GettingStartedDump } from './generated/runner-record.ts';
import type { Project } from './generated/project.ts';
import type { VariablePlan } from './generated/variable-plan.ts';
import type { Spec } from './generated/spec.ts';

export type PartialArtifact<T> = T extends readonly (infer Item)[] ? PartialArtifact<Item>[] : T extends object ? string extends keyof T ? {[K in keyof T]:PartialArtifact<T[K]>} : {[K in keyof T]?:PartialArtifact<T[K]>} : T;
export type VerifyState = PartialArtifact<Omit<RootDump,'pages'> & Omit<PageDump,'page'> & GettingStartedDump> & {
 pages?: (RootDump['pages'][number] & {children?:number})[];brand?:string|null;collectionStrategyReason?:string;
};
export type Measurements = Record<string, Extract<Spec['measurements'][string],{nodes:unknown}>>;
export const readJson = <T = unknown>(path?: string): T | null => path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null;
export const readDirJson = <T>(folder?: string): {path:string;name:string;value:T|null}[] => !folder || !existsSync(folder) ? [] : readdirSync(folder).filter(n=>n.endsWith('.json')).sort().map(name=>{const path=resolve(folder,name);try{return {path,name,value:readJson<T>(path)};}catch{return {path,name,value:null};}});

export function mergeVerifyState(folder:string):VerifyState {
 const state=readJson<VerifyState>(resolve(folder,'root.json'))??{}, project=resolve(folder,'..','..');
 const variablePlan=readJson<VariablePlan>(resolve(project,'variable-plan.json')),reason=variablePlan?.collectionStrategy?.reason;
 if(reason&&(state.collections??[]).length>1)state.collectionStrategyReason=reason+'; separate collections are reserved for an independent mode boundary';
 const run=readJson<Project>(resolve(project,'project.json'))?.run;
 if(!state.brand)state.brand=String(run?.siteLabel??'').trim()||null;
 state.components??=[];state.cards??=[];state.breakpointFrames??=[];state.exampleInvalidNodes??=[];
 const children:Record<string,number>={};
 for(const {value} of readDirJson<PageDump>(folder).filter(x=>/^page-.*\.json$/.test(x.name))){
  if(!value)continue;
  state.components.push(...value.components??[]);state.cards.push(...value.cards??[]);state.breakpointFrames.push(...value.breakpointFrames??[]);state.exampleInvalidNodes.push(...value.exampleInvalidNodes??[]);
  if(value.breakpointCollection&&!state.breakpointCollection)state.breakpointCollection=value.breakpointCollection;
  if(value.page)children[value.page.id]=value.page.children;
 }
 for(const page of state.pages??[])if(page.id in children)page.children=children[page.id]!;
 const started=readJson<GettingStartedDump>(resolve(folder,'getting-started.json'));if(started)Object.assign(state,started);
 return state;
}
export function buildMeasurements(project:string,componentInput?:{id:string;machineName?:string;sourceRef?:string}[]):Measurements {
 const components=componentInput??readJson<{components:Component[]}>(resolve(project,'components.json'))?.components??[],folder=resolve(project,'capture/measurements'),out:Measurements={};
 for(const component of components){
  const qualified=component.id.replace(/[:/]/g,'__')+'.spec.json',candidates=[resolve(folder,qualified),resolve(folder,(component.machineName||component.id.split(':').at(-1))+'.spec.json')],path=candidates.find(existsSync);if(!path)continue;
  const spec=readJson<Spec>(path)!;const source=spec.source?.sourceRef;if(source&&component.sourceRef&&source!==component.sourceRef)continue;
  const measurement=spec.measurements?.['desktop:default'];if(measurement&&'nodes' in measurement&&measurement.nodes?.length)out[component.id]=measurement;
 }
 return out;
}
export const inputBasename=basename;export const inputDirname=dirname;
