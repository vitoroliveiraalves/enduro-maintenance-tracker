// Renders the PWA icons from a small SVG mark: a knobby tyre with a red and blue
// rim, cropped from the corner, on the tricolor background (Dirt Garage).
// Run with `pnpm pwa:icons`; outputs go to public/.
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const BG = '#0f1012' // tricolor `bg` (app/assets/css/main.css)
const WHITE = '#f4f1ea'
const RED = '#d21f2a'
const BLUE = '#1f3fa8'

/** The tyre on a 120 grid, hub at (hub, hub); hub > 120 crops it from the bottom-right corner. */
function tyre(hub, { rim = true, fill = WHITE } = {}) {
  const knobs = Array.from({ length: 34 }, (_, i) => `<rect x="-5.5" y="-108" width="11" height="12" transform="rotate(${(i * 360) / 34})"/>`).join('')
  return `<g transform="translate(${hub} ${hub})" fill="${fill}">
    ${rim ? `<circle r="60" fill="none" stroke="${BLUE}" stroke-width="8"/><circle r="70" fill="none" stroke="${RED}" stroke-width="8"/>` : ''}
    <circle r="86" fill="none" stroke="${fill}" stroke-width="18"/>
    ${knobs}
  </g>`
}

/** `zoom` < 1 shrinks the art around the centre: Android shows only the middle 72/108 of a maskable icon. */
function svg(hub, zoom = 1) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 120 120">
  <rect width="120" height="120" fill="${BG}"/><g transform="translate(60 60) scale(${zoom}) translate(-60 -60)">${tyre(hub)}</g>
</svg>`
}

/** Notification badge: Android masks it by alpha only, so a solid white mark on transparent (an opaque icon shows as a white square). */
function badgeSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 120 120">${tyre(100, { rim: false, fill: '#fff' })}</svg>`
}

const out = [
  ['public/pwa-192x192.png', 192, svg(124)],
  ['public/pwa-512x512.png', 512, svg(124)],
  // Maskable: the launcher keeps only the middle two-thirds (72 of 108 dp) and masks it to its own shape,
  // so the same quarter tyre is drawn at 2/3 size; what shows matches the plain icon.
  ['public/maskable-512x512.png', 512, svg(124, 72 / 108)],
  ['public/apple-touch-icon.png', 180, svg(124)],
  ['public/badge-96x96.png', 96, badgeSvg()],
]

await mkdir('public', { recursive: true })
for (const [file, size, src] of out) {
  await sharp(Buffer.from(src)).resize(size, size).png({ compressionLevel: 9 }).toFile(file)
  console.log(`wrote ${file} (${size}×${size})`)
}
