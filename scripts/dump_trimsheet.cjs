// Dump the procedural ashlar trim sheet maps as PNGs for visual audit.
// Builds the three DataTextures exactly as textures.ts does, using the
// bundled build (esbuild-free: run through vite-node style import via tsx).
const { execSync } = require('child_process');

// Use tsx to import TS directly.
const script = `
import * as THREE from 'three';
import { createAshlarTrimSheet } from '/home/z/my-project/juzu/src/textures.ts';
import fs from 'fs';

const { albedo, normal, ormh, size } = createAshlarTrimSheet(1536);

function toPng(tex, name, srgb) {
  const data = tex.image.data;
  const W = tex.image.width, H = tex.image.height;
  const png = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    png[i*3]   = data[i*4];
    png[i*3+1] = data[i*4+1];
    png[i*3+2] = data[i*4+2];
  }
  // PPM (no deps) then convert with sharp-free approach — just write PPM.
  const header = \`P6\\n\${W} \${H}\\n255\\n\`;
  fs.writeFileSync(\`/tmp/trim_\${name}.ppm\`, Buffer.concat([Buffer.from(header), png]));
  console.log(name, W, H, 'colorSpace=', tex.colorSpace);
}
toPng(albedo, 'albedo', true);
toPng(normal, 'normal', false);
toPng(ormh, 'ormh', false);
`;
fs.writeFileSync('/tmp/dump_trim.mts', '');
execSync(`npx tsx -e "${script.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`, { stdio: 'inherit', cwd: '/home/z/my-project/juzu' });
