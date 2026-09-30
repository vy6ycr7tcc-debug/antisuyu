export class InputManager {
  public keys: Record<string, boolean> = {};
  public joystickVector: { x: number; y: number } = { x: 0, y: 0 };
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
  }

  isDown(code: string): boolean {
    return !!this.keys[code];
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
