/**
 * Discover rail/header icons as transparent PNGs with a real Gaussian shadow.
 * react-native-svg filters are not trusted on low-end Android, so the shadow is
 * baked once here and shown with <Image>.
 *
 * Run (resvg is not a project dependency):
 *   npm install --prefix <tmp> @resvg/resvg-js@2.6.2
 *   NODE_PATH=<tmp>/node_modules node scripts/icons/generateRailIcons.cjs
 *
 * Output: assets/icons/<name>-<tone>{,@2x,@3x}.png, canvas 32dp (24dp glyph + 4dp shadow pad).
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.join(__dirname, '..', '..');
const LUCIDE = path.join(ROOT, 'node_modules', 'lucide-react-native', 'dist', 'cjs', 'icons');
const OUT = path.join(ROOT, 'assets', 'icons');

const GLYPH = 24;
const PAD = 4;
const CANVAS = GLYPH + PAD * 2;
const STROKE = 1.6;
/** CSS-style blur 3px ≈ stdDeviation 1.5. */
const BLUR_STD = 1.5;
const SHADOW_OPACITY = 0.45;
const SHADOW_DY = 1;
const ACCENT = '#FE382B';

const TONES = {
  light: { color: '#FFFFFF', shadow: '#000000' },
  dark: { color: '#111827', shadow: '#FFFFFF' },
};

const ICONS = [
  { name: 'sparkles', file: 'sparkles' },
  { name: 'shopping-bag', file: 'shopping-bag' },
  { name: 'heart', file: 'heart' },
  { name: 'heart-liked', file: 'heart', fill: ACCENT, stroke: ACCENT },
  { name: 'badge-check', file: 'badge-check' },
  { name: 'search', file: 'search' },
  { name: 'sliders-horizontal', file: 'sliders-horizontal' },
];

/** Reads lucide's icon node literal without loading react-native-svg. */
function iconNode(file) {
  const src = fs.readFileSync(path.join(LUCIDE, `${file}.js`), 'utf8');
  const match = src.match(/const __iconData = (\{[\s\S]*?\n\});/);
  if (!match) throw new Error(`icon data not found: ${file}`);
  return new Function(`return ${match[1]};`)().node;
}

const attr = (props) => Object.entries(props)
  .filter(([key]) => key !== 'key')
  .map(([key, value]) => `${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${value}"`)
  .join(' ');

function svgFor(icon, tone) {
  const { color, shadow } = TONES[tone];
  const shapes = iconNode(icon.file).map(([tag, props]) => `<${tag} ${attr(props)}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD} ${-PAD} ${CANVAS} ${CANVAS}">
  <defs>
    <filter id="s" filterUnits="userSpaceOnUse" x="${-PAD}" y="${-PAD}" width="${CANVAS}" height="${CANVAS}">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${BLUR_STD}"/>
      <feOffset dy="${SHADOW_DY}" result="b"/>
      <feFlood flood-color="${shadow}" flood-opacity="${SHADOW_OPACITY}"/>
      <feComposite in2="b" operator="in" result="sh"/>
      <feMerge><feMergeNode in="sh"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g filter="url(#s)" fill="${icon.fill ?? 'none'}" stroke="${icon.stroke ?? color}" stroke-width="${STROKE}"
    stroke-linecap="round" stroke-linejoin="round">${shapes}</g>
</svg>`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const icon of ICONS) {
  for (const tone of Object.keys(TONES)) {
    const svg = svgFor(icon, tone);
    for (const scale of [1, 2, 3]) {
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: CANVAS * scale } }).render().asPng();
      const suffix = scale === 1 ? '' : `@${scale}x`;
      fs.writeFileSync(path.join(OUT, `${icon.name}-${tone}${suffix}.png`), png);
    }
  }
}
console.log(`wrote ${ICONS.length * 2 * 3} icons to ${path.relative(ROOT, OUT)}`);
