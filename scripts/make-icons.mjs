// Gera os ícones do app (build/icon.png e build/icon.ico) a partir do SVG.
// Uso: node scripts/make-icons.mjs
import sharp from 'sharp'
import pngToIco from 'png-to-ico'
import { mkdirSync, writeFileSync } from 'fs'

const SVG = 'src/renderer/src/assets/icon-app-inside.svg'
const DENSITY = 384 // renderiza o SVG em alta resolução p/ ficar nítido

mkdirSync('build', { recursive: true })

// PNG 512 (base para Mac/Linux e para o electron-builder)
await sharp(SVG, { density: DENSITY }).resize(512, 512).png().toFile('build/icon.png')

// ICO multi-resolução (Windows)
const sizes = [256, 128, 64, 48, 32, 16]
const buffers = await Promise.all(
  sizes.map((s) => sharp(SVG, { density: DENSITY }).resize(s, s).png().toBuffer())
)
writeFileSync('build/icon.ico', await pngToIco(buffers))

console.log('Ícones gerados: build/icon.png (512) + build/icon.ico (16–256)')
