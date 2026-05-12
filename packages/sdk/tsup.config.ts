import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: 'safest',
  sourcemap: true,
  splitting: false,
  minify: false,
  keepNames: true,
  target: 'es2022',
  outDir: 'dist',
})
