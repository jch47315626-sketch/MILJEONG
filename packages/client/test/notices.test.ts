import { describe, expect, test } from 'vitest';
import { MAP, type GameEvent } from '@miljeong/shared';
import { eventNotice, sabotageIndicator } from '../src/ui/notices';
import { S } from '../src/strings';

describe('sabotageIndicator', () => {
  test('null when no sabotage; 정전; 검문: <passage name>', () => {
    expect(sabotageIndicator(null)).toBeNull();
    expect(sabotageIndicator({ kind: 'blackout' })).toBe('정전');
    const p = MAP.passages[0];
    expect(sabotageIndicator({ kind: 'checkpoint', passageId: p.id, endsAt: 1 })).toBe(`검문: ${p.name}`);
  });
  test('unknown passage id falls back to the bare label', () => {
    expect(sabotageIndicator({ kind: 'checkpoint', passageId: 'nope', endsAt: 1 })).toBe('검문');
  });
});

describe('eventNotice', () => {
  test('informed → notice only for the victim', () => {
    expect(S.game.notice.informed).toContain('끌려갔습니다');
    expect(eventNotice({ e: 'informed', victim: 'me' }, 'me')).toBe(S.game.notice.informed);
    expect(eventNotice({ e: 'informed', victim: 'x' }, 'me')).toBeNull();
  });
  test('other events → no notice', () => {
    const others: GameEvent[] = [
      { e: 'sabotageStarted', kind: 'blackout' },
      { e: 'sabotageEnded' },
      { e: 'taskDone', player: 'me' },
      { e: 'meetingStarted', reason: 'bell', caller: 'me' },
    ];
    for (const e of others) expect(eventNotice(e, 'me')).toBeNull();
  });
});
