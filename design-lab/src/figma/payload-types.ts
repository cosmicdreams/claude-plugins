/** Portable JSON payload contracts, shared by Node producers and stripped sandbox templates.
 * No ambient plugin API (which redeclares Node's fetch/console) enters Node typechecking. */
import type { Tree, TreeNode, Text as TreeText, Layout } from '../generated/tree.ts';
import type { Fonts } from '../generated/fonts.ts';
import type { PlannedVariable, VariableCollection as PlanCollection } from '../generated/variable-plan.ts';
type HyperlinkTarget = {type:'URL'|'NODE';value:string};
export const VARIABLE_SCOPES = ['ALL_SCOPES','TEXT_CONTENT','CORNER_RADIUS','WIDTH_HEIGHT','GAP','ALL_FILLS','FRAME_FILL','SHAPE_FILL','TEXT_FILL','STROKE_COLOR','STROKE_FLOAT','EFFECT_FLOAT','EFFECT_COLOR','OPACITY','COLOR_OPACITY','FONT_FAMILY','FONT_STYLE','FONT_WEIGHT','FONT_SIZE','LINE_HEIGHT','LETTER_SPACING','PARAGRAPH_SPACING','PARAGRAPH_INDENT'] as const;
export type WireVariableScope = typeof VARIABLE_SCOPES[number];
export type FoundationEffect = {
  type:'DROP_SHADOW'|'INNER_SHADOW';color:{r:number;g:number;b:number;a:number};
  offset:{x:number;y:number};radius:number;spread?:number;visible:boolean;
  blendMode:'PASS_THROUGH'|'NORMAL'|'DARKEN'|'MULTIPLY'|'LINEAR_BURN'|'COLOR_BURN'|'LIGHTEN'|'SCREEN'|'LINEAR_DODGE'|'COLOR_DODGE'|'OVERLAY'|'SOFT_LIGHT'|'HARD_LIGHT'|'DIFFERENCE'|'EXCLUSION'|'HUE'|'SATURATION'|'COLOR'|'LUMINOSITY';
};
export type RoleName = 'display'|'lede'|'eyebrowDk'|'statNote'|'provDark'|'coverTitle'|'coverSub'|'coverTotal'|'coverUnit'|'coverTileValue'|'coverTileLabel'|'title'|'heading'|'eyebrow'|'body'|'bodyStrong'|'small'|'code'|'cell'|'cellHead'|'cellCode'|'chip'|'column'|'bandLine'|'bandNote'|'stat'|'observed'|'watch'|'defect'|'quote';
export type PayloadValue = string|number|boolean|null|PayloadValue[]|{[key:string]:PayloadValue};
export type TableCell = string | number | boolean | null | undefined | { text: PayloadValue|undefined; role?: RoleName; link?: HyperlinkTarget | null };
export interface Column { title: string; width: number; role?: RoleName }
export type KitArgs = Record<string,never>;
export type PagesArgs = { pages:string[] };
export type WipeArgs = { fileKey?:string;collections:string[] };
export type VariablesArgs = { collections:Record<string,{modes: PlanCollection["modes"];variables:(Omit<PlannedVariable,'scopes'> & {scopes?:WireVariableScope[];value?:number|boolean|string|{r:number;g:number;b:number;a?:number}})[]}> };
export interface CoverArgs { pageId:string;ground:string;headline:string;subtitle?:string;total?:{value:string|number;label:string};tiers?:{key:string;value:string|number;label:string;color:string}[];provenance?:{source?:string;commit?:string;siteUrl?:string;captureWidths?:number[];standardVersion?:string;runtime?:string;builtOn?:string;regenerate?:string;stage?:string};version?:string }
export interface TierPageArgs {pageId:string;title:string;summary:string[];thresholds?:string;emptyLine?:string|null}
export interface ComponentBlockArgs {pageId:string;setId:string;id:string;order:number;doc:{label:string;machine:string;tier:string;purpose?:string|null;chips?:string[];facts:[string,string,string?][];properties?:string[][];fields?:string[][];relations?:string[];notes?:string[]};columns:{label:string;width:number;master?:boolean;mode?:string}[];evidence?:{label:string;width:number;height:number}[];captured?:string;collection:string;backdrop?:string;fileKey?:string}
export interface ExamplesArgs {pageId:string;collection:string;desktopMode:string;mobileMode:string;pages:{address:string;title:string;items:({missing:string;componentId?:never;label?:never;desktop?:never;mobile?:never}|{missing?:never;componentId:string;label:string;desktop:number|null;mobile:number|null})[]}[]}
export interface GettingStartedArgs {pageId:string;title:string;what:string;whatNot:string;coverage:{columns:PartialColumn[];rows:TableCell[][]};organisation:string[];thresholds:{columns:PartialColumn[];rows:TableCell[][]};blockGuide:TableCell[][];index:{placements:number;label:string;machine:string;tier:string;type:string;status:string;setId?:string|null;blockId?:string|null}[];gaps:string[];changelog?:TableCell[][];regenerate:string[]}
export type PartialColumn = Omit<Column,'width'> & {width?:number};
export interface VoiceArgs {pageId:string;lede:string;positioning?:{line:string;supporting:string[];attribution:string}|null;stats:{value:string|number;label:string;qualifier?:string}[];sections:{title:string;rows:{kind:'OBSERVED'|'WATCH';rule:string;evidence:string}[]}[];vocabulary:{phrase:string;count:number}[];mechanics:TableCell[][];inconsistencies:string[]}
type FoundationBase = {title:string;note?:string|null};
export type FoundationSection = FoundationBase & (
 {kind:'color';swatches:{variable:string;label:string;value:string;code?:string|null;alias?:string|null}[]}|
 {kind:'type-family';families:{variable:string;family:string;code?:string|null;sample:string}[]}|
 {kind:'type-scale';rows:{label:string;family:string;weight:number;style?:string;size:number;lineHeight?:number|null;spec:string;sample:string;measured?:boolean}[]}|
 {kind:'spacing'|'radius';steps:{variable:string;label:string;value:number;code?:string|null}[]}|
 {kind:'shadow';steps:{label:string;css:string;code?:string|null;effect?:FoundationEffect}[]});
export interface FoundationArgs {pageId:string;title:string;intro:string[];sections:FoundationSection[]}
/** Compact wire nodes preserve the generated discriminant, adding only compact encodings. */
export type PaddingValue = NonNullable<NonNullable<Layout['padding']>['top']>;
export type RenderTextStyle = Omit<TreeText, 'characters'>;
/** Text may be compact (ts/chars) before expand restores its full style. */
export type RenderTree = TreeNode extends infer Node
  ? Node extends TreeNode
    ? Omit<Node, 'children'|'layout'|'text'> & {
        children?: RenderTree[];
        layout?: Layout & {pad?:[PaddingValue,PaddingValue,PaddingValue,PaddingValue]};
      } & (Node extends {kind:'text'}
        ? {text:TreeText;ts?:never;chars?:never}|{text?:never;ts:number;chars:string}
        : {text?:TreeText;ts?:number;chars?:string})
    : never
  : never;
export interface TemplateArgs {
  _cache: KitArgs;
  _kit: KitArgs;
  build_responsive: BuildResponsiveArgs;
  component_block: ComponentBlockArgs;
  cover: CoverArgs;
  examples: ExamplesArgs;
  foundation: FoundationArgs;
  getting_started: GettingStartedArgs;
  pages: PagesArgs;
  tier_page: TierPageArgs;
  variables: VariablesArgs;
  voice: VoiceArgs;
  wipe: WipeArgs;
  figma_dump_root: KitArgs;
  figma_dump_tree: KitArgs;
  figma_dump_page: KitArgs;
  figma_dump_getting_started: KitArgs;
}
export type ExpandedRenderTree = TreeNode extends infer Node
  ? Node extends TreeNode ? Omit<Node, 'children'|'layout'> & {children?: ExpandedRenderTree[];layout?:Layout & {pad?:[PaddingValue,PaddingValue,PaddingValue,PaddingValue]}} : never
  : never;
export interface BuildResponsiveArgs {pageId:string;x:number;y:number;id:string;name:string;description?:string;collection:string;modeNames:Record<'Desktop'|'Tablet'|'Mobile',string>;variables:Record<string,{type:Tree['variables'][string]['type'];values:Tree['variables'][string]['values'] & {Desktop?:Tree['variables'][string]['values'][string]}}>;tree:RenderTree;styles?:RenderTextStyle[];alternates?:{label:string;tree:RenderTree;styles?:RenderTextStyle[]}[];fonts?:Fonts['build']|null;masters?:Record<string,string>;existingComponentId?:string|null;variant?:Record<string,string>}
