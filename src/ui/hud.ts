import { UIEngineState } from './state.js';

export class HUDManager {
  private container: HTMLElement;
  private overlay: HTMLElement;

  private healthFill: HTMLElement;
  private staminaFill: HTMLElement;
  private promptText: HTMLElement;
  private objectiveText: HTMLElement;

  private idleTimer: number = 0;
  private readonly IDLE_TIMEOUT: number = 5000; // ms
  private lastStateHash: string = '';

  constructor(parent: HTMLElement) {
    this.container = parent;

    this.overlay = document.createElement('div');
    this.overlay.id = 'hud-overlay';
    // Initially visible until idle
    this.overlay.className = '';

    this.overlay.innerHTML = `
      <div class="hud-top">
        <div class="objective-tracker">
          <div class="objective-title">Current Objective</div>
          <div class="objective-text" id="hud-objective-text"></div>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="status-bars">
          <div class="bar-container">
            <div id="health-fill" class="bar-fill"></div>
          </div>
          <div class="bar-container">
            <div id="stamina-fill" class="bar-fill"></div>
          </div>
        </div>
        <div id="context-prompt" class="context-prompt"></div>
      </div>
    `;

    this.container.appendChild(this.overlay);

    this.healthFill = this.overlay.querySelector('#health-fill') as HTMLElement;
    this.staminaFill = this.overlay.querySelector('#stamina-fill') as HTMLElement;
    this.promptText = this.overlay.querySelector('#context-prompt') as HTMLElement;
    this.objectiveText = this.overlay.querySelector('#hud-objective-text') as HTMLElement;
  }

  public update(dt: number, state: UIEngineState) {
    const p = state.player;
    const o = state.objective;

    const currentHash = `${p.getHealth()}-${p.getStamina()}-${p.getTraversalState()}-${p.getPrompt()}-${o.getCurrentObjective()}`;

    if (currentHash !== this.lastStateHash) {
      // State changed, reset idle timer and show HUD
      this.idleTimer = 0;
      this.overlay.classList.remove('hidden');
      this.lastStateHash = currentHash;

      // Update DOM
      const healthPct = Math.max(0, Math.min(100, (p.getHealth() / p.getMaxHealth()) * 100));
      this.healthFill.style.width = `${healthPct}%`;

      const staminaPct = Math.max(0, Math.min(100, (p.getStamina() / p.getMaxStamina()) * 100));
      this.staminaFill.style.width = `${staminaPct}%`;

      const prompt = p.getPrompt();
      if (prompt) {
        this.promptText.textContent = prompt;
        this.promptText.classList.add('visible');
      } else {
        this.promptText.classList.remove('visible');
      }

      this.objectiveText.textContent = o.getCurrentObjective();
    } else {
      // State hasn't changed, increment idle timer
      this.idleTimer += dt * 1000;
      if (this.idleTimer > this.IDLE_TIMEOUT && !this.overlay.classList.contains('hidden')) {
        this.overlay.classList.add('hidden');
      }
    }
  }

  public setVisible(visible: boolean) {
    if (visible) {
      this.overlay.style.display = 'flex';
      // Reset idle to show immediately if re-enabled
      this.idleTimer = 0;
      this.overlay.classList.remove('hidden');
    } else {
      this.overlay.style.display = 'none';
    }
  }
}
