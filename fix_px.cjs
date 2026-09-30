const fs = require('fs');
let content = fs.readFileSync('src/terrain.ts', 'utf8');
content = content.replace("const worldX = px + worldOffsetX;", "const worldX = position.getX(i) + worldOffsetX;");
fs.writeFileSync('src/terrain.ts', content);
