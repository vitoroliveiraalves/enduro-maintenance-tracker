// Renders the PWA icons from a small SVG mark: an orange knobby tyre on the
// app background. Run with `pnpm pwa:icons`; outputs go to public/.
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const BG = '#121417'
const ACCENT = '#ff6a00'

/** The tyre mark centred in a 512 box, scaled by `scale` (maskable icons need a safe zone). */
function svg(scale, rounded) {
  const knobs = Array.from({ length: 16 }, (_, i) => {
    const a = (i * 360) / 16
    return `<rect x="-17" y="-196" width="34" height="40" rx="6" transform="rotate(${a})"/>`
  }).join('')
  const spokes = Array.from({ length: 6 }, (_, i) => `<rect x="-7" y="-98" width="14" height="58" rx="5" transform="rotate(${i * 60})"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}" ${rounded ? 'rx="96"' : ''}/>
  <g transform="translate(256 256) scale(${scale})" fill="${ACCENT}">
    ${knobs}
    <circle r="160" fill="none" stroke="${ACCENT}" stroke-width="44"/>
    <circle r="104" fill="none" stroke="${ACCENT}" stroke-width="10" opacity="0.55"/>
    ${spokes}
    <circle r="40"/>
    <circle r="16" fill="${BG}"/>
  </g>
</svg>`
}

const out = [
  ['public/pwa-192x192.png', 192, svg(1, false)],
  ['public/pwa-512x512.png', 512, svg(1, false)],
  // Maskable: the mark stays inside the central 80 % safe zone.
  ['public/maskable-512x512.png', 512, svg(0.74, false)],
  ['public/apple-touch-icon.png', 180, svg(0.92, false)],
]

await mkdir('public', { recursive: true })
for (const [file, size, src] of out) {
  await sharp(Buffer.from(src)).resize(size, size).png({ compressionLevel: 9 }).toFile(file)
  console.log(`wrote ${file} (${size}×${size})`)
}
