export interface GameConfig {
  minPlayers: 4;
  maxPlayers: 10;
  /** tiles per second */
  moveSpeed: number;
  informRange: 1.5;
  informCooldownMs: number;
  reportRange: 1.5;
  bellRange: 1.5;
  bellUnlockMs: number;
  taskRange: 1.5;
  taskMinMs: 1500;
  sabotageCooldownMs: number;
  checkpointDurationMs: 15000;
  fixRange: 1.5;
  discussMs: number;
  voteMs: number;
  ejectingMs: number;
  reconnectGraceMs: 30000;
  visionFighter: 5;
  visionSpy: 6;
  visionBlackout: 1.5;
  revealRoleOnEject: boolean;
  chatMaxLen: 100;
  chatMinIntervalMs: 1000;
}

export const DEFAULT_CONFIG: GameConfig = {
  minPlayers: 4,
  maxPlayers: 10,
  moveSpeed: 4,
  informRange: 1.5,
  informCooldownMs: 30000,
  reportRange: 1.5,
  bellRange: 1.5,
  bellUnlockMs: 15000,
  taskRange: 1.5,
  taskMinMs: 1500,
  sabotageCooldownMs: 40000,
  checkpointDurationMs: 15000,
  fixRange: 1.5,
  discussMs: 60000,
  voteMs: 30000,
  ejectingMs: 5000,
  reconnectGraceMs: 30000,
  visionFighter: 5,
  visionSpy: 6,
  visionBlackout: 1.5,
  revealRoleOnEject: true,
  chatMaxLen: 100,
  chatMinIntervalMs: 1000,
};

/** Shortened timings for E2E tests (server uses it when MILJEONG_FAST=1). */
export const FAST_CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  bellUnlockMs: 1000,
  discussMs: 3000,
  voteMs: 3000,
  ejectingMs: 1000,
  informCooldownMs: 2000,
  sabotageCooldownMs: 2000,
};

/** Number of spies for a given player count: 4~6 -> 1, 7~10 -> 2. */
export function spyCountFor(n: number): 1 | 2 {
  return n >= 7 ? 2 : 1;
}
