// Dump the procedural ashlar trim sheet maps as PPMs for visual audit.
import * as THREE from 'three';
import { createAshlarTrimSheet } from '../src/textures.js';
import fs from 'node:fs';

const { albedo, normal, ormh, size } = createAshlarTrimSheet(1536);

function toPpm(tex: THREE.DataTexture, name: string): void {
  const data = tex.image.data as Uint8Array;
  const W = tex.image.width, H = tex.image.height;
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  const header = `P6\n${W} ${H}\n255\n`;
  fs.writeFileSync(`/tmp/trim_${name}.ppm`, Buffer.concat([Buffer.from(header), rgb]));
  console.log(name, `${W}x${H}`, 'colorSpace=', tex.colorSpace);
}

toPpm(albedo, 'albedo');
toPpm(normal, 'normal');
toPpm(ormh, 'ormh');
