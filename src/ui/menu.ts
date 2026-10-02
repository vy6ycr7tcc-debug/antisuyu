export class MenuManager {
  private container: HTMLElement;
  private overlay: HTMLElement;
  public isOpen: boolean = false;

  // Callbacks
  public onResume?: () => void;
  public onPause?: () => void;  // P-MOBILE: touch pause button + input release hook
  public onQuit?: () => void;

  constructor(parent: HTMLElement) {
    this.container = parent;

    this.overlay = document.createElement('div');
    this.overlay.id = 'pause-menu';
    this.overlay.className = 'hidden';

    this.overlay.innerHTML = `
      <h2>PAUSED</h2>
      <div class="pause-menu-list">
        <button id="btn-resume">Resume Journey</button>

        <div class="settings-panel">
          <div class="setting-row">
            <label>Quality Tier</label>
            <select id="select-quality">
              <option value="high">High (Adaptive)</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div class="setting-row">
            <label>Master Volume</label>
            <input type="range" id="range-volume" min="0" max="100" value="100">
          </div>
        </div>

        <button id="btn-quit" style="margin-top: 2rem;">Quit to Title</button>
      </div>
    `;

    this.container.appendChild(this.overlay);

    // Event Listeners
    this.overlay.querySelector('#btn-resume')?.addEventListener('click', () => {
      this.close();
    });

    this.overlay.querySelector('#btn-quit')?.addEventListener('click', () => {
      if (this.onQuit) this.onQuit();
    });

    this.overlay.querySelector('#select-quality')?.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      console.log('Quality stub set to:', target.value);
    });

    this.overlay.querySelector('#range-volume')?.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      console.log('Volume stub set to:', target.value);
    });

    // We capture Escape globally at the capture phase so we can stop propagation if we consume it
    window.addEventListener('keydown', this.handleKeyDown.bind(this), true);
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.code === 'Escape') {
      // Toggle menu
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
      e.stopImmediatePropagation();
      e.preventDefault();
    } else if (this.isOpen) {
      // If menu is open, swallow all other keys to prevent gameplay
      e.stopImmediatePropagation();
    }
  }

  public open() {
    this.isOpen = true;
    this.overlay.classList.remove('hidden');
    this.overlay.classList.add('visible');
    if (this.onPause) this.onPause();
  }

  public close() {
    this.isOpen = false;
    this.overlay.classList.remove('visible');
    this.overlay.classList.add('hidden');
    if (this.onResume) this.onResume();
  }
}
