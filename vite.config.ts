import { defineConfig, Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

function getFilesFromDir(dir: string, base: string = ''): string[] {
  let results: string[] = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
       // Recurse into subdir
       results = results.concat(getFilesFromDir(filePath, path.join(base, file)));
    } else {
       // Push relative path
       results.push(path.join(base, file));
    }
  });
  return results;
}

function pwaAssetsPlugin(): Plugin {
  return {
    name: 'pwa-assets-plugin',
    apply: 'build',
    enforce: 'post',
    generateBundle(options, bundle) {
      const assets: string[] = [];

      // 1. Get bundle assets (JS, CSS, hashed assets)
      for (const fileName in bundle) {
        if (fileName !== 'sw.js') {
          assets.push(`/juzu/${fileName}`);
        }
      }

      // 2. Get public assets
      const publicDir = path.resolve(import.meta.dirname, 'public');
      if (fs.existsSync(publicDir)) {
         const publicFiles = getFilesFromDir(publicDir);
         for (const file of publicFiles) {
            // Normalizing separators for web
            const normalized = file.split(path.sep).join('/');
            assets.push(`/juzu/${normalized}`);
         }
      }

      // Read sw.js from the bundle and inject the assets
      const swChunk = bundle['sw.js'];
      if (swChunk && swChunk.type === 'chunk') {
        const assetsJson = JSON.stringify(assets);
        swChunk.code = swChunk.code.replace(/\[\s*[`'"]__PRECACHE_ASSETS__[`'"]\s*\]/, assetsJson);
      }
    }
  };
}

export default defineConfig({
  base: '/juzu/',
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: 'index.html',
        sw: 'src/pwa/sw.ts'
      },
      output: {
        entryFileNames: chunkInfo => {
          if (chunkInfo.name === 'sw') {
            return 'sw.js';
          }
          return 'assets/[name]-[hash].js';
        }
      }
    }
  },
  plugins: [pwaAssetsPlugin()]
});
