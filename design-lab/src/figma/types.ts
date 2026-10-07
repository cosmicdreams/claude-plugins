/** Type-only contracts for stripped Figma snippets. Runtime imports are never assembled. */
import type { Tree, TreeNode, Text as TreeText, Layout, Color } from '../generated/tree.ts';
import type { Fonts } from '../generated/fonts.ts';
import type { PlannedVariable, VariableCollection as PlanCollection } from '../generated/variable-plan.ts';
import type { RunnerStep as WireRunnerStep } from '../generated/runner-step.ts';
export type { TreeNode, TreeText, Layout, Color, PlannedVariable };
export interface BuildCache { buildId?: string; loadedFonts: Map<string, Promise<void>>; fonts?: Font[]; variables?: Variable[]; collections?: VariableCollection[] }
declare global { var __designLabBuildCache: BuildCache | undefined; }
export declare const DL_API: {
 fonts(): Promise<Font[]>; loadFont(font: FontName): Promise<void>;
 variables(): Promise<Variable[]>; collections(): Promise<VariableCollection[]>; invalidateVariables(): void;
 createVariable(...args: Parameters<PluginAPI['variables']['createVariable']>): Variable;
 createCollection(...args: Parameters<PluginAPI['variables']['createVariableCollection']>): VariableCollection;
};
export type RoleName = 'display'|'lede'|'eyebrowDk'|'statNote'|'provDark'|'coverTitle'|'coverSub'|'coverTotal'|'coverUnit'|'coverTileValue'|'coverTileLabel'|'title'|'heading'|'eyebrow'|'body'|'bodyStrong'|'small'|'code'|'cell'|'cellHead'|'cellCode'|'chip'|'column'|'bandLine'|'bandNote'|'stat'|'observed'|'watch'|'defect'|'quote';
export type Role = [string, string, number, number, string, number, TextNode['textCase']];
// In-process helper options use explicit undefined as the unset sentinel, like omitted keys.
// They are never persisted; generated artifact types still require absent optional keys.
export type TextOptions = { name?: string; width?: number; link?: HyperlinkTarget | null | undefined; align?: TextNode['textAlignHorizontal'] };
export type StackOptions = { name?: string | undefined; gap?: number; pad?: number | {t:number;r:number;b:number;l:number}; fill?: string | undefined; radius?: number; stroke?: string; width?: number; height?: number; align?: FrameNode['counterAxisAlignItems']; justify?: FrameNode['primaryAxisAlignItems']; wrap?: boolean; rowGap?: number };
export type Child = SceneNode | null | undefined | false | Child[];
export type TableCell = string | number | boolean | null | undefined | { text: unknown; role?: RoleName; link?: HyperlinkTarget | null };
export interface Column { title: string; width: number; role?: RoleName }
export declare const KIT: { font:string;mono:string;coverFont:{family:string;styles:Record<string,string>};coverInk:string;ink:{strong:string;body:string;muted:string;faint:string;inverse:string};surface:{page:string;panel:string;sunken:string;rule:string;chip:string;dark:string;defect:string};link:string;radius:{panel:number;chip:number;swatch:number};space:{xs:number;s:number;m:number;l:number;xl:number;xxl:number;panel:number;page:number;block:number};width:{page:number;doc:number} };
export declare const ROLES: Record<RoleName,Role>;
export declare function rgb(hex:string): RGB;
export declare function solid(hex:string, opacity?:number): SolidPaint[];
export declare function loadKitFonts(): Promise<void>;
export declare function text(characters:unknown, role:RoleName, options?:TextOptions): TextNode;
export declare function stack(direction:'VERTICAL'|'HORIZONTAL',options?:StackOptions):FrameNode;
export declare function add<T extends BaseNode & ChildrenMixin>(parent:T,...children:Child[]):T;
export declare function fillWidth<T extends SceneNode>(node:T):T;
export declare function chip(label:string):FrameNode;
export declare function rule(width:number):RectangleNode;
export declare function table(columns:Column[],rows:TableCell[][],options?:{name?:string;width?:number}):FrameNode;
export declare function section(title:string,width:number,...content:Child[]):FrameNode;
export declare function tag<T extends BaseNode>(node:T,key:string,value:unknown):T;
export declare function onPage(id:string):Promise<PageNode>;
export declare function clearTagged(root:ChildrenMixin,key:string,value:unknown):number;
export declare function atomic<T>(page:PageNode,keep:string[],body:()=>Promise<T>):Promise<T>;
export type KitArgs = Record<string,never>;
export type PagesArgs = { pages:string[] };
export type WipeArgs = { fileKey?:string;collections:string[] };
export type VariablesArgs = { collections:Record<string,{modes: PlanCollection["modes"];variables:(PlannedVariable & {scopes?:VariableScope[];value?:VariableValue})[]}> };
export interface CoverArgs { pageId:string;ground:string;headline:string;subtitle?:string;total?:{value:string|number;label:string};tiers?:{key:string;value:string|number;label:string;color:string}[];provenance?:Record<string,unknown>;version?:string }
export interface TierPageArgs {pageId:string;title:string;summary:string[];thresholds?:string;emptyLine?:string}
export interface ComponentBlockArgs {pageId:string;setId:string;id:string;order:number;doc:{label:string;machine:string;tier:string;purpose?:string;chips?:string[];facts:[string,string,string?][];properties?:string[][];fields?:string[][];relations?:string[];notes?:string[]};columns:{label:string;width:number;master?:boolean;mode?:string}[];evidence?:{label:string;width:number;height:number}[];captured?:string;collection:string;backdrop?:string;fileKey?:string}
export interface ExamplesArgs {pageId:string;collection:string;desktopMode:string;mobileMode:string;pages:{address:string;title:string;items:{missing?:string;componentId:string;desktop?:number;mobile?:number}[]}[]}
export interface GettingStartedArgs {pageId:string;title:string;what:string;whatNot:string;coverage:{columns:PartialColumn[];rows:TableCell[][]};organisation:string[];thresholds:{columns:PartialColumn[];rows:TableCell[][]};blockGuide:TableCell[][];index:{placements:number;label:string;machine:string;tier:string;type:string;status:string;setId?:string;blockId?:string}[];gaps:string[];changelog?:TableCell[][];regenerate:string[]}
export type PartialColumn = Omit<Column,'width'> & {width?:number};
export interface VoiceArgs {pageId:string;lede:string;positioning?:{line:string;supporting:string[];attribution:string}|null;stats:{value:string|number;label:string;qualifier?:string}[];sections:{title:string;rows:{kind:'OBSERVED'|'WATCH';rule:string;evidence:string}[]}[];vocabulary:{phrase:string;count:number}[];mechanics:TableCell[][];inconsistencies:string[]}
type FoundationBase = {title:string;note?:string|null};
export type FoundationSection = FoundationBase & (
 {kind:'color';swatches:{variable:string;label:string;value:string;code?:string;alias?:string}[]}|
 {kind:'type-family';families:{variable:string;family:string;code?:string;sample:string}[]}|
 {kind:'type-scale';rows:{label:string;family:string;weight:number;style?:string;size:number;lineHeight?:number;spec:string;sample:string;measured?:boolean}[]}|
 {kind:'spacing'|'radius';steps:{variable:string;label:string;value:number;code?:string}[]}|
 {kind:'shadow';steps:{label:string;css:string;code?:string;effect?:DropShadowEffect|InnerShadowEffect}[]});
export interface FoundationArgs {pageId:string;title:string;intro:string[];sections:FoundationSection[]}
/** Compact wire nodes preserve the generated discriminant, adding only compact encodings. */
export type RenderTree = TreeNode & {ts?:number;chars?:string;children?:RenderTree[];layout?:Layout & {pad?:[number,number,number,number]}};
export interface BuildResponsiveArgs {pageId:string;x:number;y:number;id:string;name:string;description?:string;collection:string;modeNames:Record<'Desktop'|'Tablet'|'Mobile',string>;variables:Record<string,{type:VariableResolvedDataType;values:Record<string,VariableValue>}>;tree:RenderTree;styles?:TreeText[];alternates?:{label:string;tree:RenderTree;styles?:TreeText[]}[];fonts?:Fonts['build']|null;masters?:Record<string,string>;existingComponentId?:string;variant?:Record<string,string>}
export type RunnerStep = WireRunnerStep;
export type RunnerReply = WireRunnerStep;
export type BindingValue = number|boolean|{var:string}|null|undefined;
export type BindingNode = BaseNode & Pick<LayoutMixin,'resize'|'width'|'height'> & {setBoundVariable(field:VariableBindableNodeField|VariableBindableTextField, variable:Variable|null):void};
export type StyledNode = Pick<FrameNode,'fills'|'strokes'|'strokeAlign'|'strokeTopWeight'|'strokeRightWeight'|'strokeBottomWeight'|'strokeLeftWeight'|'topLeftRadius'|'topRightRadius'|'bottomRightRadius'|'bottomLeftRadius'|'effects'|'opacity'>;
export type SizedNode = BindingNode & Pick<FrameNode,'layoutMode'|'layoutSizingHorizontal'|'layoutSizingVertical'|'primaryAxisSizingMode'|'counterAxisSizingMode'|'height'|'parent'> & Pick<TextNode,'fontSize'|'textAutoResize'>;
// These report entries always construct the keys in memory; JSON serialization omits
// undefined fit/sourceId values before the generated closed result contract is validated.
export interface RenderReport {created:number;bound:number;literal:number;variables:number;fonts:Record<string,string>;missingFonts:string[];standIns:Record<string,string>;styleFallbacks:Record<string,string>;iconText:Record<string,number>;nested:{sourceId:string|undefined;id:string}[];nestedMismatch:{sourceId:string|undefined;name:string;texts:number[];images:number[]}[];images:{id:string;src:string;fit:string|undefined}[];svgFailures:string[];fellBack:string[];notes?:string[]}
