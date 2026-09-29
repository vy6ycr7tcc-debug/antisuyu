export class InputManager {
  public keys: Record<string, boolean> = {};

  constructor() {
    window.addEventListener('keydown', (e) => this.keys[e.code] = true);
    window.addEventListener('keyup', (e) => this.keys[e.code] = false);
  }

  isDown(code: string): boolean {
    return !!this.keys[code];
  }
}
