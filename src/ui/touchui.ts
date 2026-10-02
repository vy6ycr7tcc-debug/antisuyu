// P-MOBILE F2: pause affordance for touch devices. The pause menu was
// Escape-only — unreachable on an iPhone. This button is the single touch
// entry point into the existing MenuManager; main.ts wires the toggle.
// Lives inside #ui-root so shot mode hides it (world captures stay clean).
export interface TouchUIHandlers {
  onPauseToggle: () => void;
}

export class TouchUI {
  public button: HTMLButtonElement;

  constructor(parent: HTMLElement, handlers: TouchUIHandlers) {
    this.button = document.createElement('button');
    this.button.id = 'btn-touch-pause';
    this.button.className = 'touch-pause-btn';
    this.button.textContent = 'MENU';
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onPauseToggle();
    });
    parent.appendChild(this.button);
  }

  public setVisible(visible: boolean): void {
    this.button.style.display = visible ? 'block' : 'none';
  }
}
