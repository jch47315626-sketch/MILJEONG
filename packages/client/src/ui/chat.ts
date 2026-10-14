import type { ChatMsg } from '@miljeong/shared';
import { S } from '../strings';
import { el } from './dom';

export const CHAT_MAX_LEN = 100;

type RosterName = { id: string; name: string };

/** Renders chat lines with el() only: message text is always a text node, never HTML. */
export function renderChat(list: ChatMsg[], roster: RosterName[]): HTMLElement {
  return el(
    'div',
    { class: 'chat-list', 'data-testid': 'chat-list' },
    ...list.map((m) =>
      el(
        'div',
        { class: 'chat-msg', 'data-testid': 'chat-msg' },
        el('strong', { class: 'chat-from' }, roster.find((r) => r.id === m.from)?.name ?? '?'),
        el('span', { class: 'chat-text' }, m.text),
      ),
    ),
  );
}

export interface ChatLog {
  root: HTMLElement;
  update(list: ChatMsg[], roster: RosterName[]): void;
}

/**
 * A scrolling, read-only chat log. Rebuilt only when the list changes (views arrive at
 * 20Hz). The key includes the last sender: a capped list keeps its length when it shifts.
 */
export function createChatLog(attrs: Record<string, string> = {}): ChatLog {
  const log = el('div', { class: 'chat-log', ...attrs });
  let lastKey = '';
  return {
    root: log,
    update(list, roster) {
      const last = list[list.length - 1];
      const key = `${list.length}:${last?.at ?? ''}:${last?.from ?? ''}`;
      if (key === lastKey) return;
      lastKey = key;
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
      log.replaceChildren(renderChat(list, roster));
      if (atBottom) log.scrollTop = log.scrollHeight;
    },
  };
}

/** Enter that only ends an IME composition (Safari/iOS fires it with keyCode 229) must not send. */
export function isSubmitEnter(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
}

export interface ChatPanel {
  root: HTMLElement;
  update(list: ChatMsg[], roster: RosterName[]): void;
  focus(): void;
}

/** A chat log + input. */
export function createChatPanel(send: (text: string) => void): ChatPanel {
  const log = createChatLog();
  const input = el('input', {
    type: 'text',
    maxlength: String(CHAT_MAX_LEN),
    placeholder: S.meeting.chatPlaceholder,
    autocomplete: 'off',
    'data-testid': 'chat-input',
  });
  const submit = (): void => {
    const text = input.value.trim();
    if (text === '') return;
    send(text);
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (isSubmitEnter(e)) {
      e.preventDefault();
      submit();
    }
  });
  const sendBtn = el('button', { type: 'button', 'data-testid': 'chat-send', onclick: submit }, S.meeting.send);
  const root = el('div', { class: 'chat-panel' }, log.root, el('div', { class: 'chat-row' }, input, sendBtn));
  return {
    root,
    update: (list, roster) => log.update(list, roster),
    focus: () => input.focus(),
  };
}
