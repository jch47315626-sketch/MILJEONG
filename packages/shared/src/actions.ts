import { applyBell } from './actions/bell';
import { applyInform } from './actions/inform';
import { applyReport } from './actions/report';
import { applyVote } from './actions/vote';
import { applyChat } from './actions/chat';
import { applyMove } from './actions/move';
import { applyTaskComplete, applyTaskStart } from './actions/task';
import type { ApplyResult, GameState, Intent } from './types';

const BAD: ApplyResult = { ok: false, reason: 'BAD_INPUT' };

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function applyIntent(
  state: GameState,
  playerId: string,
  intent: Intent,
  now: number,
): ApplyResult {
  if (!isStr(playerId) || typeof intent !== 'object' || intent === null) return BAD;
  if (!isNum(now)) return BAD;
  const i = intent as Record<string, unknown>;
  switch (i.t) {
    case 'move': {
      const d = i.dir as { x?: unknown; y?: unknown } | null;
      if (typeof d !== 'object' || d === null || !isNum(d.x) || !isNum(d.y)) return BAD;
      return applyMove(state, playerId, { x: d.x, y: d.y });
    }
    case 'taskStart':
      if (!isStr(i.taskId)) return BAD;
      return applyTaskStart(state, playerId, i.taskId, now);
    case 'taskComplete':
      if (!isStr(i.taskId)) return BAD;
      return applyTaskComplete(state, playerId, i.taskId, now);
    case 'inform':
      if (!isStr(i.target)) return BAD;
      return applyInform(state, playerId, i.target, now);
    case 'report':
      return applyReport(state, playerId, now);
    case 'bell':
      return applyBell(state, playerId, now);
    // --- Dispatcher branch for intents whose handlers arrive in Tasks 4-8.
    // Plug in by adding a file under src/actions/ and a case above.
    case 'sabotage':
    case 'fixBreaker':
      return BAD;
    case 'vote':
      if (!isStr(i.target)) return BAD;
      return applyVote(state, playerId, i.target);
    case 'chat':
      if (!isStr(i.text)) return BAD;
      return applyChat(state, playerId, i.text, now);
    default:
      return BAD;
  }
}
