import type { Spec, MeasuredNode } from '../generated/spec.ts';
export type Measurement = Spec['measurements'][string];
export type Measured = Extract<Measurement, { nodes: MeasuredNode[] }>;
export interface PickRoot {
  anchorText?: string;
  mustContain?: string;
  nth?: number;
}
export interface Viewport {
  name: string;
  width: number;
  height: number;
}
export interface CaptureState {
  name: string;
  setup?: string;
  teardown?: string;
  hover?: string;
  settle?: number;
  setupKey?: unknown;
}
export interface CaptureConfig extends PickRoot {
  component: string;
  componentId: string;
  machineName: string;
  rootSelector: string;
  path: string;
  verificationUrl: string;
  url?: string;
  linkUrl: string;
  source?: Spec['source'];
  states?: CaptureState[];
  viewports?: Viewport[];
  cookiePreferences?: false | { timeout?: number; bannerSelector?: string; closeSelector?: string };
  [key: string]: unknown;
}
export interface CaptureRow {
  componentId: string;
  machine: string;
  viewport: string;
  state?: string;
  file?: string;
  path?: string;
  verificationUrl?: string;
  linkUrl?: string;
  selector?: string;
  width?: number;
  height?: number;
  error?: string;
}
export interface CaptureRecord {
  componentId: string;
  configHash: string;
  status: 'complete' | 'failed';
  problems: string[];
  rows: CaptureRow[];
  path?: string;
  revealed?: boolean;
  seconds: number;
  measureMs: number;
  captureMs: number;
  durationMs: number;
}
