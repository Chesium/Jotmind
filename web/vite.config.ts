/// <reference types='vitest' />
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../node_modules/.vite/web',
  server: {
    port: 4200,
    host: 'localhost',
    fs: {
      allow: [
        // search up for workspace root
        searchForWorkspaceRoot(process.cwd()),
      ],
    },
  },
  preview: {
    port: 4200,
    host: 'localhost',
  },
  plugins: [
    svgr(), tailwindcss(), reactRouter(),
    nxViteTsPaths(),
    nxCopyAssetsPlugin(['*.md']),
  ],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
