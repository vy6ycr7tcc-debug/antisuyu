export class InputManager {
  public keys: Record<string, boolean> = {};
  public joystickVector: { x: number; y: number } = { x: 0, y: 0 };
  // Analog magnitude (0..1) of the virtual stick — P-MOBILE F3: the
  // character controller maps this onto the walk→run band (full deflection
  // sustains run speed). Keyboard input keeps magnitude implicit (1).
  public joystickMagnitude: number = 0;
  public cameraDelta: { x: number; y: number } = { x: 0, y: 0 };
  public tap: boolean = false;
  public hold: boolean = false;

  private isDragging = false;
  private previousMousePosition = { x: 0, y: 0 };

  constructor() {
    window.addEventListener('keydown', (e) => this.keys[e.code] = true);
    window.addEventListener('keyup', (e) => this.keys[e.code] = false);

    window.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => this.isDragging = false);
    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.cameraDelta.x += e.clientX - this.previousMousePosition.x;
        this.cameraDelta.y += e.clientY - this.previousMousePosition.y;
      }
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    // P-MOBILE F7: an app switch must never leave a key latched down
    // (the character kept walking after returning to the tab).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.keys = {};
    });
  }

  isDown(code: string): boolean {
    return !!this.keys[code];
  }

  // P-MOBILE F7: full input wipe (used alongside TouchControls.releaseAll
  // when the tab hides or the pause menu opens).
  clear(): void {
    this.keys = {};
    this.joystickVector = { x: 0, y: 0 };
    this.joystickMagnitude = 0;
    this.cameraDelta = { x: 0, y: 0 };
    this.tap = false;
    this.hold = false;
  }

  getJoystickVector(): { x: number; y: number } {
    return this.joystickVector;
  }

  getCameraDelta(): { x: number; y: number } {
    const delta = { ...this.cameraDelta };
    this.cameraDelta.x = 0;
    this.cameraDelta.y = 0;
    return delta;
  }

  consumeTap(): boolean {
    if (this.tap) {
      this.tap = false;
      return true;
    }
    return false;
  }

  consumeHold(): boolean {
    if (this.hold) {
      this.hold = false;
      return true;
    }
    return false;
  }
}

// P-MOBILE: touch-capable device probe (coarse primary pointer or real
// touchstart surface). Drives the mobile default quality tier (renderer.ts)
// and whether the touch UI layer mounts (main.ts). `&touch=1` bypasses this
// for desktop verification captures.
export function isTouchLikeDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
