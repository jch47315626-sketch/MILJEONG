import type { Intent } from '@miljeong/shared';

/**
 * Opens a task. Task 12 replaces this with the mini-game flow (taskStart, play, taskComplete).
 * `canSend` is false for spies: their task button is camouflage only and sends nothing.
 */
export function openTask(taskId: string, send: (i: Intent) => void, canSend: boolean): void {
  if (!canSend) return;
  send({ t: 'taskStart', taskId });
}
