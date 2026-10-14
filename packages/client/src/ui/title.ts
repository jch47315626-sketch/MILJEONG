import { Connection, isValidRoomCode, joinErrorMessage, normalizeCode, validNickname, ROOM_CODE_LEN, NAME_MAX_LEN } from '../net';
import { S } from '../strings';
import { el } from './dom';
import type { ScreenCtx } from '../main';

export function render(root: HTMLElement, ctx: ScreenCtx): () => void {
  const error = el('p', { class: 'error', 'data-testid': 'error', role: 'alert' }, ctx.notice ?? '');
  const nickname = el('input', {
    'data-testid': 'nickname',
    placeholder: S.nicknamePlaceholder,
    maxlength: String(NAME_MAX_LEN),
    autocomplete: 'off',
    'aria-label': S.nickname,
  });
  const codeInput = el('input', {
    'data-testid': 'code-input',
    placeholder: S.codePlaceholder,
    maxlength: String(ROOM_CODE_LEN),
    autocapitalize: 'characters',
    autocomplete: 'off',
    'aria-label': S.codePlaceholder,
  });
  const create = el('button', { 'data-testid': 'create', class: 'primary', type: 'button' }, S.create);
  const join = el('button', { 'data-testid': 'join', type: 'button' }, S.join);
  let alive = true;

  const run = async (fn: (name: string) => Promise<Connection>, precheck?: () => string | null): Promise<void> => {
    const name = validNickname(nickname.value);
    if (name === null) return void (error.textContent = S.err.badName);
    const bad = precheck?.() ?? null;
    if (bad) return void (error.textContent = bad);
    error.textContent = S.connecting;
    create.disabled = join.disabled = true;
    try {
      const conn = await fn(name);
      if (alive) ctx.enter(conn);
      else conn.leave();
    } catch (err) {
      if (!alive) return;
      error.textContent = joinErrorMessage(err);
      create.disabled = join.disabled = false;
    }
  };

  create.addEventListener('click', () => void run((n) => Connection.create(n)));
  join.addEventListener('click', () => {
    const code = normalizeCode(codeInput.value);
    void run((n) => Connection.join(code, n), () => (isValidRoomCode(code) ? null : S.err.badCode));
  });

  root.replaceChildren(
    el(
      'main',
      { class: 'screen title' },
      el('h1', {}, S.title),
      el('p', { class: 'sub' }, S.subtitle),
      nickname,
      create,
      el('hr'),
      codeInput,
      join,
      error,
    ),
  );
  return () => {
    alive = false;
  };
}
