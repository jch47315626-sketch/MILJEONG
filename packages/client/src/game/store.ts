import type { PlayerView } from '@miljeong/shared';

/** Shared between the DOM screen and the Phaser scene (no phaser import here). */
export interface GameStore {
  view: PlayerView | null;
  /** bumped on every new view so the scene knows when to refresh interpolation */
  seq: number;
}

export function newStore(): GameStore {
  return { view: null, seq: 0 };
}

export function pushView(store: GameStore, view: PlayerView): void {
  store.view = view;
  store.seq++;
}
