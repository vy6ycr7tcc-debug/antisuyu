const fs = require('fs');
let content = fs.readFileSync('src/terrain.ts', 'utf8');

const s1 = `    for (let i = 0; i < position.count; i++) {
      const pz = position.getZ(i);
      const y = position.getY(i);

      const worldX = px + worldOffsetX;
      const worldZ = pz + worldOffsetZ;`;

const r1 = `    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i);
      const pz = position.getZ(i);
      const y = position.getY(i);

      const worldX = px + worldOffsetX;
      const worldZ = pz + worldOffsetZ;`;

content = content.replace(s1, r1);
fs.writeFileSync('src/terrain.ts', content);
