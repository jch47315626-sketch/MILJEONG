import type { Ejection, PlayerView, Role } from '@miljeong/shared';
import { S } from '../strings';
import { createChatPanel } from './chat';
import { el } from './dom';

type Roster = PlayerView['roster'];

/** m:ss, rounded up so the display hits 0:00 exactly when the phase ends. */
function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "토론 0:42" while discussing, "투표 0:17" afterwards. `now` is server time (view.now). */
export function meetingTimerText(view: PlayerView, now: number): string {
  const m = view.meeting;
  if (!m) return '';
  if (now < m.discussEndsAt) return `${S.meeting.discuss} ${clock(m.discussEndsAt - now)}`;
  return `${S.meeting.vote} ${clock(m.voteEndsAt - now)}`;
}

/** 은/는 by the final consonant (batchim) of the last syllable; unknown for non-Hangul. */
export function topicParticle(name: string): string {
  const last = Array.from(name).pop();
  if (!last) return '은(는)';
  const c = last.codePointAt(0)!;
  if (c < 0xac00 || c > 0xd7a3) return '은(는)';
  return (c - 0xac00) % 28 === 0 ? '는' : '은';
}

export function ejectionText(e: Ejection, roster: Roster | { id: string; name: string }[]): string {
  if (e.playerId === null) return S.meeting.noEject;
  const name = roster.find((r) => r.id === e.playerId)?.name ?? e.playerId;
  const head = `${name}${topicParticle(name)} ${S.meeting.ejectSuffix}`;
  if (e.role === null) return head;
  return `${head} ${e.role === 'spy' ? S.meeting.wasSpy : S.meeting.wasFighter}`;
}

/**
 * Roles revealed by ejections during the current game. The view only carries an ejected
 * player's role while that ejection is the latest, so earlier ones are remembered here.
 */
export const revealedRoles = new Map<string, Role>();
export const ejectedIds = new Set<string>();
let revealGame: number | null = null;

export function trackReveals(view: PlayerView): void {
  if (revealGame !== view.startedAt) {
    revealGame = view.startedAt;
    revealedRoles.clear();
    ejectedIds.clear();
  }
  const e = view.lastEjection;
  if (e && e.playerId !== null) {
    ejectedIds.add(e.playerId);
    if (e.role !== null) revealedRoles.set(e.playerId, e.role);
  }
}

export interface MeetingDeps {
  send(intent: import('@miljeong/shared').Intent): void;
}

export interface MeetingUi {
  update(view: PlayerView): void;
  /** ghosts may chat while the game is playing: shows/hides the floating chat */
  setGhostChatOpen(open: boolean): void;
  destroy(): void;
}

export function createMeeting(parent: HTMLElement, deps: MeetingDeps): MeetingUi {
  const sendChat = (text: string): void => deps.send({ t: 'chat', text });

  const info = el('p', { class: 'meeting-info', 'data-testid': 'meeting-info' });
  const timer = el('p', { class: 'meeting-timer', 'data-testid': 'meeting-timer' });
  const cards = el('div', { class: 'vote-cards' });
  const skip = el('button', { type: 'button', class: 'vote-skip', 'data-testid': 'vote-skip', onclick: () => vote('skip') }, S.meeting.skip);
  const ghostNote = el('p', { class: 'notice', hidden: true }, S.meeting.ghostVoteInfo);
  const tab = el('div', { class: 'chat-tab', hidden: true }, S.meeting.ghostTab);
  const chat = createChatPanel(sendChat);
  const meetingEl = el(
    'div',
    { class: 'meeting-overlay', 'data-testid': 'meeting', hidden: true },
    el('div', { class: 'meeting-card' }, el('h2', {}, S.meeting.title), info, timer, cards, skip, ghostNote, tab, chat.root),
  );

  const ejectText = el('p', { class: 'ejection-text', 'data-testid': 'ejection-text' });
  const ejectionEl = el('div', { class: 'ejection-overlay', 'data-testid': 'ejection', hidden: true }, ejectText);

  const floatChat = createChatPanel(sendChat);
  const floatEl = el('div', { class: 'ghost-float', 'data-testid': 'ghost-chat' }, el('div', { class: 'chat-tab' }, S.meeting.ghostTab), floatChat.root);

  parent.append(meetingEl, ejectionEl);

  let view: PlayerView | null = null;
  let meetingKey = '';
  let myVote: string | null = null;
  let cardSig = '';
  let ghostOpen = false;
  let floatShown = false;

  function vote(target: string): void {
    const v = view;
    if (!v || !v.meeting || !canVote(v) || myVote !== null || v.meeting.voted.includes(v.me.id)) return;
    myVote = target;
    deps.send({ t: 'vote', target });
    renderCards(v);
  }

  const canVote = (v: PlayerView): boolean => v.me.alive;

  function renderCards(v: PlayerView): void {
    const m = v.meeting!;
    const hasVoted = myVote !== null || m.voted.includes(v.me.id);
    const can = canVote(v);
    const sig = JSON.stringify([v.roster, m.voted, myVote, can, v.me.id, [...ejectedIds], [...revealedRoles]]);
    skip.disabled = !can || hasVoted;
    skip.classList.toggle('chosen', myVote === 'skip');
    if (sig === cardSig) return;
    cardSig = sig;
    cards.replaceChildren(
      ...v.roster.map((r) => {
        const dead = r.publiclyDead || r.left;
        const role = revealedRoles.get(r.id);
        const status = r.left
          ? '이탈'
          : r.publiclyDead
            ? ejectedIds.has(r.id)
              ? S.meeting.ejected
              : S.meeting.dead
            : null;
        const b = el(
          'button',
          {
            type: 'button',
            class: `vote-card${dead ? ' dead' : ''}${myVote === r.id ? ' chosen' : ''}`,
            'data-testid': `vote-${r.id}`,
            disabled: !can || hasVoted || dead,
            onclick: () => vote(r.id),
          },
          el('span', { class: 'vote-name' }, r.name),
          status && el('span', { class: 'tag' }, status),
          role && el('span', { class: 'tag' }, role === 'spy' ? S.meeting.spy : S.meeting.fighter),
          m.voted.includes(r.id) && el('span', { class: 'tag voted', 'data-testid': `voted-${r.id}` }, S.meeting.voted),
        );
        return b;
      }),
    );
  }

  function updateMeeting(v: PlayerView): void {
    const m = v.meeting!;
    const key = `${v.startedAt}:${m.callerId}:${m.discussEndsAt}`;
    if (key !== meetingKey) {
      meetingKey = key;
      myVote = null;
      cardSig = '';
    }
    const caller = v.roster.find((r) => r.id === m.callerId)?.name ?? '?';
    info.textContent = `${S.meeting.caller}: ${caller} (${S.meeting.reason[m.reason]})`;
    timer.textContent = meetingTimerText(v, v.now);
    const ghost = !v.me.alive;
    ghostNote.hidden = !ghost;
    tab.hidden = !ghost;
    skip.hidden = ghost;
    renderCards(v);
    chat.update(ghost ? v.ghostChat : v.chat, v.roster);
  }

  function syncFloat(v: PlayerView): void {
    const show = ghostOpen && !v.me.alive && v.phase === 'playing';
    if (show !== floatShown) {
      floatShown = show;
      if (show) {
        parent.append(floatEl);
        floatChat.focus();
      } else floatEl.remove();
    }
    if (show) floatChat.update(v.ghostChat, v.roster);
  }

  return {
    update(v) {
      view = v;
      trackReveals(v);
      const inMeeting = v.phase === 'meeting' && v.meeting !== null;
      meetingEl.hidden = !inMeeting;
      if (inMeeting) updateMeeting(v);
      else meetingKey = '';
      const ejecting = v.phase === 'ejecting';
      ejectionEl.hidden = !ejecting;
      if (ejecting && v.lastEjection) ejectText.textContent = ejectionText(v.lastEjection, v.roster);
      syncFloat(v);
    },
    setGhostChatOpen(open) {
      ghostOpen = open;
      if (view) syncFloat(view);
    },
    destroy() {
      meetingEl.remove();
      ejectionEl.remove();
      floatEl.remove();
    },
  };
}
