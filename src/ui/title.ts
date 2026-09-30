export class TitleScreenManager {
  private container: HTMLElement;
  private overlay: HTMLElement;
  public isOpen: boolean = true;

  public onStart?: () => void;
  public onSettings?: () => void;

  constructor(parent: HTMLElement) {
    this.container = parent;

    this.overlay = document.createElement('div');
    this.overlay.id = 'title-screen';

    this.overlay.innerHTML = `
      <h1>ANTISUYU</h1>
      <div class="title-menu" id="title-menu-list" style="display: none;">
        <button id="btn-new-journey">New Journey</button>
        <button id="btn-continue" style="opacity: 0.5; cursor: not-allowed;">Continue</button>
        <button id="btn-title-settings">Settings</button>
      </div>
      <div class="press-to-begin" id="press-to-begin">PRESS ANY KEY</div>
    `;

    this.container.appendChild(this.overlay);

    const pressAnyKey = this.overlay.querySelector('#press-to-begin') as HTMLElement;
    const menuList = this.overlay.querySelector('#title-menu-list') as HTMLElement;

    const handleInitialInput = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', handleInitialInput, true);
      window.removeEventListener('click', handleInitialInput, true);

      pressAnyKey.style.display = 'none';
      menuList.style.display = 'flex';
    };

    window.addEventListener('keydown', handleInitialInput, true);
    window.addEventListener('click', handleInitialInput, true);

    this.overlay.querySelector('#btn-new-journey')?.addEventListener('click', () => {
      this.close();
      if (this.onStart) this.onStart();
    });

    this.overlay.querySelector('#btn-title-settings')?.addEventListener('click', () => {
      if (this.onSettings) this.onSettings();
    });
  }

  public open() {
    this.isOpen = true;
    this.overlay.classList.remove('hidden');
    // Reset to "Press Any Key"
    (this.overlay.querySelector('#press-to-begin') as HTMLElement).style.display = 'block';
    (this.overlay.querySelector('#title-menu-list') as HTMLElement).style.display = 'none';
  }

  public close() {
    this.isOpen = false;
    this.overlay.classList.add('hidden');
  }
}
