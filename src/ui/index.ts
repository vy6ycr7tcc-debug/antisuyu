import './styles.css';
import { UIEngineState } from './state.js';
import { HUDManager } from './hud.js';
import { MenuManager } from './menu.js';
import { TitleScreenManager } from './title.js';
import { CharacterController } from '../character.js';

export class UIManager {
  private root: HTMLElement;
  public state: UIEngineState;

  public hud: HUDManager;
  public menu: MenuManager;
  public title: TitleScreenManager;

  // Bindings
  private characterController: CharacterController | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'ui-root';
    document.body.appendChild(this.root);

    this.state = new UIEngineState();

    this.hud = new HUDManager(this.root);
    this.menu = new MenuManager(this.root);
    this.title = new TitleScreenManager(this.root);

    // Initial state
    this.hud.setVisible(false);

    // Setup logic
    this.title.onStart = () => {
      this.hud.setVisible(true);
    };

    this.title.onSettings = () => {
      this.menu.open();
    };

    this.menu.onQuit = () => {
      this.menu.close();
      this.hud.setVisible(false);
      this.title.open();
    };
  }

  public bindCharacter(character: CharacterController) {
    this.characterController = character;
  }

  public update(dt: number) {
    // If we have bound to character, map it back to UI state
    if (this.characterController) {
      // Stub health/stamina since character controller currently doesn't expose them
      // In a real system we'd map this.state.player.health = characterController.health
      this.state.player.traversalState = this.characterController.state;
    }

    // Only update HUD if we aren't in title screen
    if (!this.title.isOpen && !this.menu.isOpen) {
      this.hud.update(dt, this.state);
    }
  }
}

let instance: UIManager | null = null;

export function initUI(characterController?: CharacterController) {
  if (!instance) {
    instance = new UIManager();
  }
  if (characterController) {
    instance.bindCharacter(characterController);
  }
  return instance;
}

export function updateUI(dt: number) {
  if (instance) {
    instance.update(dt);
  }
}
