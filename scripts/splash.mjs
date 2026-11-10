// iOS launch images: the app icon centred on the manifest background. Run with `pnpm pwa:splash`; outputs go to public/splash/.
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'
import { SPLASH, splashFile } from './splash-sizes.mjs'

const BG = '#0f1012' // = manifest background_color and the icon's own background
await mkdir('public/splash', { recursive: true })
for (const [w, h, r] of SPLASH) {
  const W = w * r, H = h * r, icon = Math.round(W * 0.3)
  const mark = await sharp('public/pwa-512x512.png').resize(icon, icon).toBuffer()
  await sharp({ create: { width: W, height: H, channels: 3, background: BG } })
    .composite([{ input: mark, left: Math.round((W - icon) / 2), top: Math.round((H - icon) / 2) }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(`public/${splashFile(w, h, r)}`)
  console.log(`wrote public/${splashFile(w, h, r)}`)
}
