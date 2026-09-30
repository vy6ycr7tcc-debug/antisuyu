import { MovementState } from '../character.js';

export interface PlayerStateProvider {
  getHealth(): number;
  getMaxHealth(): number;
  getStamina(): number;
  getMaxStamina(): number;
  getTraversalState(): MovementState | string;
  getPrompt(): string | null;
}

export interface ObjectiveProvider {
  getCurrentObjective(): string;
  getObjectiveProgress(): number; // 0 to 1
}

// Stub implementation to decouple UI from unfinished backend features
export class DefaultPlayerState implements PlayerStateProvider {
  public health: number = 100;
  public maxHealth: number = 100;
  public stamina: number = 100;
  public maxStamina: number = 100;
  public traversalState: MovementState | string = 'WALK';
  public prompt: string | null = null;

  getHealth() { return this.health; }
  getMaxHealth() { return this.maxHealth; }
  getStamina() { return this.stamina; }
  getMaxStamina() { return this.maxStamina; }
  getTraversalState() { return this.traversalState; }
  getPrompt() { return this.prompt; }
}

export class DefaultObjectiveState implements ObjectiveProvider {
  public objective: string = 'Find the path to Paititi';
  public progress: number = 0;

  getCurrentObjective() { return this.objective; }
  getObjectiveProgress() { return this.progress; }
}

export class UIEngineState {
  player: DefaultPlayerState = new DefaultPlayerState();
  objective: DefaultObjectiveState = new DefaultObjectiveState();
}
