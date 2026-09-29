# Audio Contract

This document outlines how gameplay phases interface with the `AudioDirector` without modifying existing engine files.

## Instantiation

The `AudioDirector` should be instantiated with a reference to the main `THREE.Camera` (since the 3D listener attaches to it).

```typescript
import { AudioDirector } from './audio/engine';

const audioDirector = new AudioDirector(camera);
```

**Note**: To comply with browser autoplay policies, `AudioDirector.play()` or `AudioDirector.setBiome()` will implicitly attempt to resume the AudioContext, but it's recommended to call `audioDirector.resume()` explicitly on the first user interaction (like a click or keydown).

## Event Interface

### 1. Adaptive Music (Beds & Biomes)
The background music continuously crossfades based on the current biome and intensity state.

```typescript
// Change biome (affects base drone frequency/root note)
// Valid biomes: 'highlands' | 'jungle' | 'cave' | 'river'
audioDirector.setBiome('jungle');

// Change intensity layer (crossfades between layers over 2 seconds)
// Valid intensities: 'calm' | 'explore' | 'tension'
audioDirector.setIntensity('explore');
```

*When a player enters combat or a specific encounter trigger, switch the intensity to `tension`. When they clear the area, switch back to `explore` or `calm`.*

### 2. Sound Effects (3D Positional & Master)
Procedurally generated sound effects can be played directly with optional 3D positioning.

```typescript
import * as THREE from 'three';

// Play generic non-positional UI or global sound
audioDirector.play('wind', { loop: true, volume: 0.5 });

// Play 3D positional sound effect
audioDirector.play('footsteps', {
    position: new THREE.Vector3(x, y, z),
    volume: 1.0
});
```

Available SFX Types:
*   `wind` (loopable)
*   `water` (loopable)
*   `stone`
*   `cloth`
*   `breath`
*   `footsteps`
*   `quena`
*   `charango`
*   `cajon`

### 3. Update Loop
Ensure you update the AudioDirector every frame to synchronize the AudioListener's position with the Camera's position.

```typescript
function tick() {
    // ... game logic

    audioDirector.update(camera);

    // ... render
}
```
