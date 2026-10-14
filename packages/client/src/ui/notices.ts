import { MAP, type GameEvent, type MapData, type Sabotage } from '@miljeong/shared';
import { S } from '../strings';

/** HUD label for the active sabotage (from view.sabotage): "정전" / "검문: <통로 이름>", or null. */
export function sabotageIndicator(sab: Sabotage | null, map: MapData = MAP): string | null {
  if (!sab) return null;
  if (sab.kind === 'blackout') return S.game.sabotageMenu.blackout;
  const name = map.passages.find((p) => p.id === sab.passageId)?.name;
  return name ? `${S.game.sabotageMenu.checkpoint}: ${name}` : S.game.sabotageMenu.checkpoint;
}

/** Notice text for a game event addressed to me, or null when it needs none. */
export function eventNotice(e: GameEvent, myId: string): string | null {
  if (e.e === 'informed' && e.victim === myId) return S.game.notice.informed;
  return null;
}
