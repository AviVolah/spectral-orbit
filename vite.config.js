import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';

// Copy Basic Pitch model to public/model/ so Vite serves it at /model/
const modelSrc = resolve(__dirname, 'node_modules/@spotify/basic-pitch/model');
const modelDst = resolve(__dirname, 'public/model');

if (!existsSync(modelDst)) {
  mkdirSync(modelDst, { recursive: true });
}
// Copy the two model files
for (const f of ['model.json', 'group1-shard1of1.bin']) {
  const src = resolve(modelSrc, f);
  const dst = resolve(modelDst, f);
  if (existsSync(src) && !existsSync(dst)) {
    copyFileSync(src, dst);
  }
}

export default defineConfig({
  server: {
    port: 5173,
  },
});
