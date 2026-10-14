import { describe, expect, test } from 'vitest';
import { S } from '../src/strings';
import { el } from '../src/ui/dom';
import { isValidRoomCode, joinErrorMessage, normalizeCode, validNickname } from '../src/net';

describe('joinErrorMessage', () => {
  test('maps every server join error to Korean strings', () => {
    expect(joinErrorMessage({ code: 4101, message: 'ROOM_STARTED' })).toBe(S.err.roomStarted);
    expect(joinErrorMessage({ code: 4100, message: 'BAD_NAME' })).toBe(S.err.badName);
    expect(joinErrorMessage({ code: 522, message: 'room "ZZZZZZ" not found' })).toBe(S.err.roomNotFound);
    expect(joinErrorMessage({ code: 522, message: 'room "ABC234" is locked' })).toBe(S.err.roomFull);
  });
  test('falls back to the generic message', () => {
    expect(joinErrorMessage(new Error('boom'))).toBe(S.err.generic);
    expect(joinErrorMessage({ code: 522, message: 'something else' })).toBe(S.err.generic);
    expect(joinErrorMessage({ code: 500, message: 'room "X" not found' })).toBe(S.err.generic);
    expect(joinErrorMessage(null)).toBe(S.err.generic);
    expect(joinErrorMessage('str')).toBe(S.err.generic);
  });
  test('Korean strings', () => {
    expect(S.err.roomStarted).toBe('이미 시작된 방입니다');
    expect(S.err.roomFull).toBe('방이 가득 찼습니다');
    expect(S.err.roomNotFound).toBe('방을 찾을 수 없습니다');
    expect(S.err.badName).toBe('닉네임은 1~12자로 입력해 주세요');
    expect(S.err.disconnected).toBe('연결이 끊어졌습니다');
  });
});

describe('client-side validation', () => {
  test('room code', () => {
    expect(isValidRoomCode(normalizeCode(' abc234 '))).toBe(true);
    expect(isValidRoomCode('ABC23')).toBe(false);
    expect(isValidRoomCode('ABC2345')).toBe(false);
    expect(isValidRoomCode('ABCDE0')).toBe(false); // 0 not in alphabet
    expect(isValidRoomCode('ABCDEI')).toBe(false); // I not in alphabet
  });
  test('nickname', () => {
    expect(validNickname('  철수 ')).toBe('철수');
    expect(validNickname('   ')).toBeNull();
    expect(validNickname('')).toBeNull();
    expect(validNickname('가'.repeat(12))).toBe('가'.repeat(12));
    expect(validNickname('가'.repeat(13))).toBeNull();
  });
});

describe('el', () => {
  test('escapes text children', () => {
    expect(el('div', {}, '<b>x</b>').innerHTML).toBe('&lt;b&gt;x&lt;/b&gt;');
  });
  test('attrs, nodes, handlers', () => {
    let n = 0;
    const b = el('button', { 'data-testid': 'x', disabled: true, onclick: () => n++ }, el('span', {}, 'a'), null, false);
    b.click();
    expect(b.getAttribute('data-testid')).toBe('x');
    expect(b.disabled).toBe(true);
    expect(b.innerHTML).toBe('<span>a</span>');
    expect(n).toBe(0); // disabled buttons do not fire click
  });
});
