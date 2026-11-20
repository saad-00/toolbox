// Glass palettes (values from the approved prototype, reference/glass-pal.js). Graphite is the default.
export const PALETTES = [
  { id: 'graphite', bg: '#14161b', b1: '#556072', b2: '#7d8798', b3: '#2c3644' },
  { id: 'emerald', bg: '#04231c', b1: '#10b981', b2: '#34d399', b3: '#0e7490' },
  { id: 'riyadh', bg: '#0b0a1f', b1: '#f59e0b', b2: '#7c3aed', b3: '#ef4444' },
  { id: 'wine', bg: '#24070f', b1: '#e11d48', b2: '#f9a8d4', b3: '#7f1d1d' },
  { id: 'ice', bg: '#eef6fb', b1: '#93c5fd', b2: '#a5f3fc', b3: '#e0e7ff' },
  { id: 'sand', bg: '#f7efe4', b1: '#f4b183', b2: '#e9c46a', b3: '#d4a5a5' },
  { id: 'mint', bg: '#eefaf3', b1: '#86efac', b2: '#bef264', b3: '#99f6e4' },
];

const DARK = { '--ink': '#fff', '--sub': 'rgba(255,255,255,.72)', '--glass': 'rgba(255,255,255,.12)', '--glass2': 'rgba(255,255,255,.2)', '--edge': 'rgba(255,255,255,.28)', '--solid': 'rgba(255,255,255,.92)', '--shadow': 'rgba(0,0,0,.28)', '--ok': '#8BF5C8', '--bad': '#FFB3B3', '--warn': '#FFD59E' };
const LIGHT = { '--ink': '#1d2230', '--sub': 'rgba(29,34,48,.66)', '--glass': 'rgba(255,255,255,.45)', '--glass2': 'rgba(255,255,255,.66)', '--edge': 'rgba(255,255,255,.9)', '--solid': '#1d2230', '--solid-ink': '#fff', '--shadow': 'rgba(40,50,80,.14)', '--ok': '#13804f', '--bad': '#c2364a', '--warn': '#9a5b00' };

// Luminance as in the approved prototype (Rec.709 weights on sRGB channels), light when > 0.5.
export function isLight(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return false;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

// paletteOrCustom: a preset id, a preset object, or a custom {bg,b1,b2,b3}. Unknown → graphite.
export function applyPalette(root, paletteOrCustom) {
  let p = paletteOrCustom;
  if (typeof p === 'string' || !p || !p.bg) p = PALETTES.find((x) => x.id === p) || PALETTES[0];
  const light = isLight(p.bg);
  const vars = { ...(light ? LIGHT : DARK), '--bg': p.bg, '--b1': p.b1, '--b2': p.b2, '--b3': p.b3 };
  if (!light) vars['--solid-ink'] = p.bg;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = light ? 'light' : 'dark';
  globalThis.document?.querySelector?.('meta[name=theme-color]')?.setAttribute('content', p.bg);
  return light ? 'light' : 'dark';
}
