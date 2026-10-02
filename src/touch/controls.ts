import { InputManager } from '../input.js';

// P-MOBILE (docs/plans/phase-5-mobile-controls.md): iPhone-grade touch layer.
// - Left 40% of the screen = dynamic-origin virtual joystick with a VISIBLE
//   base ring + knob (F4), resting bottom-left inside the safe area.
// - Right 60% = camera look drag, active whenever a finger drags there —
//   no longer gated on the stick being held (F5).
// - Analog magnitude is published to InputManager (F3) so the character can
//   blend walk→run from stick deflection.
// - Events originating inside UI roots never claim a joystick/look slot (F6).
// - releaseAll() wipes every held pointer/vector (F7: app switch, menu open).
export interface TouchControlsOptions {
  // Touch UI is only visible on touch-capable devices (or &touch=1 captures).
  active?: boolean;
}

const JOYSTICK_DEADZONE = 12;
const JOYSTICK_MAX_RADIUS = 50;
// Left fraction of screen width that owns the movement stick.
const ZONE_SPLIT = 0.4;

const TAP_THRESHOLD_MS = 250;
const HOLD_THRESHOLD_MS = 500;
const MOVEMENT_THRESHOLD_PX = 10;
const HOLD_DURATION_MS = 800; // time to fill ring

// Selectors whose touches belong to the UI layer, never to the game pad.
const UI_TARGET_SELECTOR = '#ui-root, #touch-root, button, input, select, textarea, a';

// P-MOBILE verification hook (plan §P5.3): live pad state for the gate
// runner — proves event DELIVERY (pointer ids), accumulation (camera delta)
// and stick deflection without screenshot guessing.
declare global {
  interface Window {
    __touchDebug?: {
      left: number | null;
      right: number | null;
      camX: number;
      camY: number;
      mag: number;
    };
  }
}

export class TouchControls {
  private input: InputManager;
  private leftPointerId: number | null = null;
  private rightPointerId: number | null = null;
  private active: boolean;

  // Joystick state
  private joystickOrigin = { x: 0, y: 0 };
  private joystickVector = { x: 0, y: 0 };
  private joystickMagnitude = 0;

  // Camera drag state
  private rightPointerLastPos = { x: 0, y: 0 };

  // Tap/Hold Recognizer state
  private touchStartTime = 0;
  private touchStartPos = { x: 0, y: 0 };
  private holdUI: HTMLElement | null = null;
  private currentHoldTime = 0;
  private isHolding = false;

  // Touch UI elements (assigned in buildTouchUI from the constructor)
  private touchRoot!: HTMLElement;
  private joystickBase!: HTMLElement;
  private joystickKnob!: HTMLElement;

  private boundPointerDown = this.handlePointerDown.bind(this);
  private boundPointerMove = this.handlePointerMove.bind(this);
  private boundPointerUp = this.handlePointerUp.bind(this);
  private boundPointerCancel = this.handlePointerCancel.bind(this);
  private boundTouchStart = this.handleTouchStart.bind(this);

  constructor(input: InputManager, options: TouchControlsOptions = {}) {
    this.input = input;
    this.active = options.active ?? false;

    const target = document.body;
    target.addEventListener('pointerdown', this.boundPointerDown);
    target.addEventListener('pointermove', this.boundPointerMove, { passive: false });
    target.addEventListener('pointerup', this.boundPointerUp);
    target.addEventListener('pointercancel', this.boundPointerCancel);
    // Prevent default touch behaviors (double-tap zoom, long-press callout,
    // scroll rubber-banding) for game-surface touches only — UI elements
    // keep their native click synthesis (P-MOBILE F1 fix depends on this).
    target.addEventListener('touchstart', this.boundTouchStart, { passive: false });

    this.buildTouchUI();
  }

  // ---------------------------------------------------------------- UI layer

  private buildTouchUI(): void {
    this.touchRoot = document.createElement('div');
    this.touchRoot.id = 'touch-root';

    this.joystickBase = document.createElement('div');
    this.joystickBase.id = 'touch-joystick-base';
    this.joystickBase.classList.add('resting');

    this.joystickKnob = document.createElement('div');
    this.joystickKnob.id = 'touch-joystick-knob';
    this.joystickBase.appendChild(this.joystickKnob);

    this.touchRoot.appendChild(this.joystickBase);
    document.body.appendChild(this.touchRoot);

    this.createHoldUI();
    this.applyActive();
  }

  private createHoldUI(): void {
    this.holdUI = document.createElement('div');
    this.holdUI.style.position = 'absolute';
    this.holdUI.style.width = '60px';
    this.holdUI.style.height = '60px';
    this.holdUI.style.borderRadius = '50%';
    this.holdUI.style.border = '4px solid rgba(255, 255, 255, 0.3)';
    this.holdUI.style.pointerEvents = 'none';
    this.holdUI.style.transform = 'translate(-50%, -50%)';
    this.holdUI.style.display = 'none';
    this.holdUI.style.zIndex = '1000';

    // Progress ring using conic-gradient
    this.holdUI.innerHTML = `<div id="hold-progress" style="width: 100%; height: 100%; border-radius: 50%; background: conic-gradient(rgba(255,255,255,0.8) 0deg, transparent 0deg);"></div>`;
    this.touchRoot.appendChild(this.holdUI);
  }

  public setActive(active: boolean): void {
    this.active = active;
    this.applyActive();
  }

  private applyActive(): void {
    this.joystickBase.style.display = this.active ? 'block' : 'none';
    if (this.active) this.resetJoystickUI();
  }

  // ------------------------------------------------------------- input guard

  // P-MOBILE F6: touches that begin on UI elements are owned by the UI —
  // they must not claim joystick/look slots or emit game taps. Only the
  // DOWN event is guarded: once a pointer is claimed, MOVE/UP keep routing
  // to it even if the finger slides over HUD chrome.
  private isUITargetDown(e: PointerEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && typeof t.closest === 'function' && t.closest(UI_TARGET_SELECTOR) !== null;
  }

  private handleTouchStart(e: TouchEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && typeof t.closest === 'function' && t.closest(UI_TARGET_SELECTOR) !== null) return;
    e.preventDefault();
  }

  // ------------------------------------------------------------ event wiring

  private publishDebug(): void {
    window.__touchDebug = {
      left: this.leftPointerId,
      right: this.rightPointerId,
      camX: this.input.cameraDelta.x,
      camY: this.input.cameraDelta.y,
      mag: this.joystickMagnitude,
    };
  }

  private handlePointerDown(e: PointerEvent) {
    if (e.pointerType !== 'touch' || this.isUITargetDown(e)) return;

    const halfWidth = window.innerWidth * ZONE_SPLIT;

    if (e.clientX < halfWidth) {
      if (this.leftPointerId === null) {
        this.leftPointerId = e.pointerId;
        this.joystickOrigin = { x: e.clientX, y: e.clientY };
        this.joystickVector = { x: 0, y: 0 };
        this.joystickMagnitude = 0;
        this.publishJoystick();
        this.engageJoystickUI(e.clientX, e.clientY);
      }
    } else {
      if (this.rightPointerId === null) {
        this.rightPointerId = e.pointerId;
        this.rightPointerLastPos = { x: e.clientX, y: e.clientY };

        // Tap/Hold reset
        this.touchStartTime = performance.now();
        this.touchStartPos = { x: e.clientX, y: e.clientY };
        this.currentHoldTime = 0;
        this.isHolding = false;

        if (this.holdUI) {
          this.holdUI.style.left = `${e.clientX}px`;
          this.holdUI.style.top = `${e.clientY}px`;
        }
      }
    }
    this.publishDebug();
  }

  private handlePointerMove(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;

    if (e.pointerId === this.leftPointerId) {
      e.preventDefault();
      this.updateJoystick(e.clientX, e.clientY);
    } else if (e.pointerId === this.rightPointerId) {
      e.preventDefault();

      const dx = e.clientX - this.touchStartPos.x;
      const dy = e.clientY - this.touchStartPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > MOVEMENT_THRESHOLD_PX) {
        // Moved too much, cancel hold
        this.isHolding = false;
        this.currentHoldTime = 0;
        if (this.holdUI) {
          this.holdUI.style.display = 'none';
        }
      }

      // P-MOBILE F5: the look drag now works whenever the right zone is
      // dragged — walking no longer required (the old gate broke the most
      // used gesture in the genre).
      this.input.cameraDelta.x += e.clientX - this.rightPointerLastPos.x;
      this.input.cameraDelta.y += e.clientY - this.rightPointerLastPos.y;

      this.rightPointerLastPos = { x: e.clientX, y: e.clientY };
    }
    this.publishDebug();
  }

  private handlePointerUp(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;

    if (e.pointerId === this.leftPointerId) {
      this.leftPointerId = null;
      this.joystickVector = { x: 0, y: 0 };
      this.joystickMagnitude = 0;
      this.publishJoystick();
      this.resetJoystickUI();
    } else if (e.pointerId === this.rightPointerId) {
      this.rightPointerId = null;

      const elapsed = performance.now() - this.touchStartTime;
      const dx = e.clientX - this.touchStartPos.x;
      const dy = e.clientY - this.touchStartPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < MOVEMENT_THRESHOLD_PX) {
        if (elapsed < TAP_THRESHOLD_MS) {
          this.input.tap = true;
        } else if (this.isHolding && this.currentHoldTime >= HOLD_DURATION_MS) {
          this.input.hold = true;
        }
      }

      this.isHolding = false;
      this.currentHoldTime = 0;
      if (this.holdUI) {
        this.holdUI.style.display = 'none';
      }
    }
    this.publishDebug();
  }

  private handlePointerCancel(e: PointerEvent) {
    this.handlePointerUp(e);
  }

  // ------------------------------------------------------------- joystick UI

  private engageJoystickUI(x: number, y: number): void {
    // Re-origin under the thumb; clamp so the ring stays fully on screen.
    const margin = JOYSTICK_MAX_RADIUS + 12;
    const cx = Math.min(Math.max(x, margin), window.innerWidth * ZONE_SPLIT - margin);
    const cy = Math.min(Math.max(y, margin), window.innerHeight - margin);
    this.joystickBase.classList.remove('resting');
    this.joystickBase.style.left = `${cx}px`;
    this.joystickBase.style.top = `${cy}px`;
  }

  private updateJoystick(x: number, y: number): void {
    const dx = x - this.joystickOrigin.x;
    const dy = y - this.joystickOrigin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > JOYSTICK_DEADZONE) {
      const magnitude = Math.min(dist, JOYSTICK_MAX_RADIUS) / JOYSTICK_MAX_RADIUS;
      this.joystickVector = {
        x: (dx / dist) * magnitude,
        y: (dy / dist) * magnitude
      };
      this.joystickMagnitude = magnitude;

      const clamped = Math.min(dist, JOYSTICK_MAX_RADIUS);
      const kx = dist > 0 ? (dx / dist) * clamped : 0;
      const ky = dist > 0 ? (dy / dist) * clamped : 0;
      this.joystickKnob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    } else {
      this.joystickVector = { x: 0, y: 0 };
      this.joystickMagnitude = 0;
      this.joystickKnob.style.transform = 'translate(-50%, -50%)';
    }
    this.publishJoystick();
  }

  private resetJoystickUI(): void {
    this.joystickBase.style.left = '';
    this.joystickBase.style.top = '';
    this.joystickBase.classList.add('resting');
    this.joystickKnob.style.transform = 'translate(-50%, -50%)';
  }

  private publishJoystick(): void {
    this.input.joystickVector = this.joystickVector;
    this.input.joystickMagnitude = this.joystickMagnitude;
  }

  // ------------------------------------------------------------ frame update

  public update(dt: number) {
    if (this.rightPointerId !== null) {
      const elapsed = performance.now() - this.touchStartTime;

      if (elapsed >= HOLD_THRESHOLD_MS) {
        if (this.holdUI && !this.isHolding) {
          this.isHolding = true;
          this.holdUI.style.display = 'block';
        }

        if (this.isHolding) {
          this.currentHoldTime += dt * 1000;

          if (this.holdUI) {
            const progress = document.getElementById('hold-progress');
            if (progress) {
              const pct = Math.min(this.currentHoldTime / HOLD_DURATION_MS, 1.0);
              const degrees = pct * 360;
              progress.style.background = `conic-gradient(rgba(255,255,255,0.8) ${degrees}deg, transparent ${degrees}deg)`;
            }
          }
        }
      }
    }
  }

  // P-MOBILE F7: drop every held pointer and zero every vector — called on
  // visibilitychange→hidden and when the pause menu opens.
  public releaseAll(): void {
    this.leftPointerId = null;
    this.rightPointerId = null;
    this.joystickVector = { x: 0, y: 0 };
    this.joystickMagnitude = 0;
    this.publishJoystick();
    this.isHolding = false;
    this.currentHoldTime = 0;
    if (this.holdUI) this.holdUI.style.display = 'none';
    this.resetJoystickUI();
    this.publishDebug();
  }
}
