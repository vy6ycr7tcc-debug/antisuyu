import { InputManager } from '../input.js';

export class TouchControls {
    private input: InputManager;
    private leftPointerId: number | null = null;
    private rightPointerId: number | null = null;

    // Joystick state
    private joystickOrigin = { x: 0, y: 0 };
    private joystickVector = { x: 0, y: 0 };
    private readonly JOYSTICK_DEADZONE = 12;
    private readonly JOYSTICK_MAX_RADIUS = 50;

    // Camera drag state
    private rightPointerLastPos = { x: 0, y: 0 };

    // Tap/Hold Recognizer state
    private touchStartTime = 0;
    private touchStartPos = { x: 0, y: 0 };
    private holdUI: HTMLElement | null = null;
    private currentHoldTime = 0;
    private isHolding = false;
    private readonly TAP_THRESHOLD_MS = 250;
    private readonly HOLD_THRESHOLD_MS = 500;
    private readonly MOVEMENT_THRESHOLD_PX = 10;
    private readonly HOLD_DURATION_MS = 800; // time to fill ring

    constructor(input: InputManager) {
        this.input = input;

        // Bind event listeners
        this.handlePointerDown = this.handlePointerDown.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handlePointerCancel = this.handlePointerCancel.bind(this);

        const target = document.body;
        target.addEventListener('pointerdown', this.handlePointerDown);
        target.addEventListener('pointermove', this.handlePointerMove, { passive: false });
        target.addEventListener('pointerup', this.handlePointerUp);
        target.addEventListener('pointercancel', this.handlePointerCancel);

        // Prevent default touch behaviors like double-tap zoom
        target.addEventListener('touchstart', (e) => {
            if (e.target instanceof HTMLElement && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
            }
        }, { passive: false });

        this.createHoldUI();
    }

    private createHoldUI() {
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
        document.body.appendChild(this.holdUI);
    }

    private handlePointerDown(e: PointerEvent) {
        if (e.pointerType !== 'touch') return;

        const halfWidth = window.innerWidth / 2;

        if (e.clientX < halfWidth) {
            if (this.leftPointerId === null) {
                this.leftPointerId = e.pointerId;
                this.joystickOrigin = { x: e.clientX, y: e.clientY };
                this.joystickVector = { x: 0, y: 0 };
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
    }

    private handlePointerMove(e: PointerEvent) {
        if (e.pointerType !== 'touch') return;

        // Let UI buttons handle themselves if needed
        if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') return;

        e.preventDefault();

        if (e.pointerId === this.leftPointerId) {
            // Left pointer move
            const dx = e.clientX - this.joystickOrigin.x;
            const dy = e.clientY - this.joystickOrigin.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > this.JOYSTICK_DEADZONE) {
                const magnitude = Math.min(dist, this.JOYSTICK_MAX_RADIUS) / this.JOYSTICK_MAX_RADIUS;
                this.joystickVector = {
                    x: (dx / dist) * magnitude,
                    y: (dy / dist) * magnitude
                };
            } else {
                this.joystickVector = { x: 0, y: 0 };
            }
            // Ensure InputManager knows about it
            this.input.joystickVector = this.joystickVector;

        } else if (e.pointerId === this.rightPointerId) {
            // Right pointer move

            const dx = e.clientX - this.touchStartPos.x;
            const dy = e.clientY - this.touchStartPos.y;
            if (Math.sqrt(dx * dx + dy * dy) > this.MOVEMENT_THRESHOLD_PX) {
                // Moved too much, cancel hold
                this.isHolding = false;
                this.currentHoldTime = 0;
                if (this.holdUI) {
                    this.holdUI.style.display = 'none';
                }
            }

            // Only update camera if left thumb is also touching the joystick (as per requirements)
            if (this.leftPointerId !== null) {
                this.input.cameraDelta.x += e.clientX - this.rightPointerLastPos.x;
                this.input.cameraDelta.y += e.clientY - this.rightPointerLastPos.y;
            }

            this.rightPointerLastPos = { x: e.clientX, y: e.clientY };
        }
    }

    private handlePointerUp(e: PointerEvent) {
        if (e.pointerType !== 'touch') return;

        if (e.pointerId === this.leftPointerId) {
            this.leftPointerId = null;
            this.joystickVector = { x: 0, y: 0 };
            this.input.joystickVector = this.joystickVector;
        } else if (e.pointerId === this.rightPointerId) {
            this.rightPointerId = null;

            const elapsed = performance.now() - this.touchStartTime;
            const dx = e.clientX - this.touchStartPos.x;
            const dy = e.clientY - this.touchStartPos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < this.MOVEMENT_THRESHOLD_PX) {
                if (elapsed < this.TAP_THRESHOLD_MS) {
                    this.input.tap = true;
                } else if (this.isHolding && this.currentHoldTime >= this.HOLD_DURATION_MS) {
                    this.input.hold = true;
                }
            }

            this.isHolding = false;
            this.currentHoldTime = 0;
            if (this.holdUI) {
                this.holdUI.style.display = 'none';
            }
        }
    }

    private handlePointerCancel(e: PointerEvent) {
        this.handlePointerUp(e);
    }

    public update(dt: number) {
        if (this.rightPointerId !== null) {
            const elapsed = performance.now() - this.touchStartTime;

            if (elapsed >= this.HOLD_THRESHOLD_MS) {
                if (this.holdUI && !this.isHolding) {
                    this.isHolding = true;
                    this.holdUI.style.display = 'block';
                }

                if (this.isHolding) {
                    this.currentHoldTime += dt * 1000;

                    if (this.holdUI) {
                        const progress = document.getElementById('hold-progress');
                        if (progress) {
                            const pct = Math.min(this.currentHoldTime / this.HOLD_DURATION_MS, 1.0);
                            const degrees = pct * 360;
                            progress.style.background = `conic-gradient(rgba(255,255,255,0.8) ${degrees}deg, transparent ${degrees}deg)`;
                        }
                    }
                }
            }
        }
    }
}
