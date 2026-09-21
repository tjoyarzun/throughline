/**
 * Throughline design tokens — "Archival Cinema".
 *
 * Every token that renders text declares WHICH background it sits on and at what
 * size, in USAGE_MATRIX below. tests/unit/contrast.test.ts computes the real WCAG
 * ratio for each declared usage and fails the build if it is short.
 *
 * This matters because the first palette draft assigned body text to --text-faint
 * (3.4:1) and active-nav labels to --accent in light mode (3.2:1). Both fail AA.
 * A token is only as safe as the usage it is put to, so the usage is the thing
 * we test. See docs/ui.md and the spec section "Accessibility acceptance criteria".
 */

export const dark = {
  bg: '#0B0C0E',
  surface: '#141619',
  surface2: '#1D2024',
  border: '#2A2E34',
  text: '#ECEDEF',
  textDim: '#9AA0A8',
  /** DECORATIVE ONLY: hairline dividers. Exempt from 1.4.11; never carries meaning. */
  faint: '#3A3F46',
  /** Interactive boundaries that DO carry meaning: input outline, selected state. 3.39:1. */
  borderStrong: '#61666E',
  /** Third text tier when one is genuinely needed. Passes AA for body. */
  textFaint: '#7B818A',
  accent: '#E8C77A',
  /** Focus ring. Must clear 3:1 against every ground it lands on (1.4.11, 2.4.11). */
  focus: '#E8C77A',
  positive: '#6FAE8C',
  negative: '#C2685E',
} as const;

export const light = {
  bg: '#FBFAF8',
  surface: '#FFFFFF',
  surface2: '#F3F1ED',
  border: '#E2DFD9',
  text: '#16181B',
  textDim: '#5F6670',
  /** DECORATIVE ONLY. */
  faint: '#D8D4CD',
  /** Interactive boundaries that carry meaning. 3.67:1. */
  borderStrong: '#7D838B',
  textFaint: '#6B7078',
  /** NON-TEXT UI ONLY in light mode (3.2:1). Never an accent-colored text label. */
  accent: '#A8842C',
  positive: '#3E7D5F',
  negative: '#A84A3F',
  /** 3.35:1 on bg, 3.50:1 on surface. */
  focus: '#A8842C',
} as const;

/**
 * Categorical node fills. Color is SUPPLEMENTARY only: every node also carries a
 * text label and a `borderStrong` stroke, so type is never conveyed by hue alone
 * (1.4.1) and the shape is always perceivable (1.4.11 is satisfied by the stroke,
 * not the fill). Provenance is shown by stroke style — derived edges render dashed.
 */
export const graphPalette = {
  title: '#7FA8D9',
  person: '#E8C77A',
  concept: '#9C8FD4',
  collection: '#D98F7F',
  organization: '#7FBFA8',
  character: '#D97FB0',
  work: '#B8A88A',
} as const;

export type Scheme = 'dark' | 'light';
export type UsageKind = 'body' | 'large' | 'nonText' | 'decorative';

/**
 * WCAG 2.2 AA thresholds. 1.4.3 for text, 1.4.11 for non-text UI.
 *
 * `decorative` is 1.0 on purpose, not as an escape hatch: 1.4.11 explicitly
 * exempts purely decorative elements. A hairline divider carries no meaning and
 * has no threshold. The moment a border indicates state, focus, or a field
 * boundary it is `nonText` and must clear 3:1 — that is what `borderStrong` and
 * `focus` are for. Blanket-darkening every rule to 3:1 would over-apply the
 * criterion and destroy the editorial look for no accessibility gain.
 */
export const THRESHOLD: Record<UsageKind, number> = {
  body: 4.5,
  large: 3.0,
  nonText: 3.0,
  decorative: 1.0,
};

export interface Usage {
  readonly scheme: Scheme;
  readonly token: string;
  readonly on: string;
  readonly kind: UsageKind;
  readonly where: string;
}

/**
 * Declared usages. Adding a token to the UI means adding a row here first.
 * `faint` and light-mode `accent` deliberately appear only as `nonText`.
 */
export const USAGE_MATRIX: readonly Usage[] = [
  { scheme: 'dark', token: 'text', on: 'bg', kind: 'body', where: 'body copy' },
  { scheme: 'dark', token: 'text', on: 'surface', kind: 'body', where: 'card copy' },
  { scheme: 'dark', token: 'textDim', on: 'bg', kind: 'body', where: 'secondary copy, metadata' },
  { scheme: 'dark', token: 'textDim', on: 'surface', kind: 'body', where: 'card metadata' },
  {
    scheme: 'dark',
    token: 'textFaint',
    on: 'bg',
    kind: 'body',
    where: 'provenance line, timestamps',
  },
  { scheme: 'dark', token: 'faint', on: 'bg', kind: 'decorative', where: 'hairline dividers' },
  {
    scheme: 'dark',
    token: 'borderStrong',
    on: 'bg',
    kind: 'nonText',
    where: 'input outline, selected state',
  },
  {
    scheme: 'dark',
    token: 'borderStrong',
    on: 'surface',
    kind: 'nonText',
    where: 'input outline on a card',
  },
  { scheme: 'dark', token: 'focus', on: 'bg', kind: 'nonText', where: 'focus ring (2.4.11)' },
  { scheme: 'dark', token: 'focus', on: 'surface', kind: 'nonText', where: 'focus ring on a card' },
  {
    scheme: 'dark',
    token: 'accent',
    on: 'bg',
    kind: 'body',
    where: 'star fill, active nav, theme chips',
  },
  { scheme: 'dark', token: 'positive', on: 'bg', kind: 'nonText', where: 'progress fill' },
  { scheme: 'dark', token: 'negative', on: 'bg', kind: 'body', where: 'error text' },
  { scheme: 'dark', token: 'border', on: 'bg', kind: 'decorative', where: 'card hairline' },

  { scheme: 'light', token: 'text', on: 'bg', kind: 'body', where: 'body copy' },
  { scheme: 'light', token: 'text', on: 'surface', kind: 'body', where: 'card copy' },
  { scheme: 'light', token: 'textDim', on: 'bg', kind: 'body', where: 'secondary copy, metadata' },
  { scheme: 'light', token: 'textDim', on: 'surface', kind: 'body', where: 'card metadata' },
  {
    scheme: 'light',
    token: 'textFaint',
    on: 'bg',
    kind: 'body',
    where: 'provenance line, timestamps',
  },
  { scheme: 'light', token: 'faint', on: 'bg', kind: 'decorative', where: 'hairline dividers' },
  {
    scheme: 'light',
    token: 'borderStrong',
    on: 'bg',
    kind: 'nonText',
    where: 'input outline, selected state',
  },
  {
    scheme: 'light',
    token: 'borderStrong',
    on: 'surface',
    kind: 'nonText',
    where: 'input outline on a card',
  },
  { scheme: 'light', token: 'focus', on: 'bg', kind: 'nonText', where: 'focus ring (2.4.11)' },
  {
    scheme: 'light',
    token: 'focus',
    on: 'surface',
    kind: 'nonText',
    where: 'focus ring on a card',
  },
  // Light accent is a UI indicator only — an accent-colored text label would fail AA.
  {
    scheme: 'light',
    token: 'accent',
    on: 'bg',
    kind: 'nonText',
    where: 'star fill, focus ring, indicator bar',
  },
  { scheme: 'light', token: 'positive', on: 'bg', kind: 'nonText', where: 'progress fill' },
  { scheme: 'light', token: 'negative', on: 'bg', kind: 'body', where: 'error text' },
  { scheme: 'light', token: 'border', on: 'bg', kind: 'decorative', where: 'card hairline' },
];

export const palettes: Record<Scheme, Record<string, string>> = { dark, light };

// --- WCAG 2.1 relative luminance + contrast ratio -------------------------
export function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
