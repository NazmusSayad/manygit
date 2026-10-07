import { defineConfig } from 'tsdown'
import packageJSON from './package.json' with { type: 'json' }

export default defineConfig({
  entry: {
    index: './src/index.tsx',
  },

  format: 'es',
  outDir: './dist',
  tsconfig: './tsconfig.json',

  target: 'ES2022',
  minify: 'dce-only',
  dts: false,

  deps: {
    neverBundle: [
      /node:/gim,
      ...getExternal((packageJSON as any).dependencies),
    ],
  },
})

function getExternal(dependencies: unknown) {
  return Object.keys((dependencies ?? {}) as Record<string, string>).map(
    (dep) => new RegExp(`(^${dep}$)|(^${dep}/)`)
  )
}
