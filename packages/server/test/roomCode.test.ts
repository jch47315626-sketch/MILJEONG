import { describe, expect, test } from 'vitest';
import { createRng } from '@miljeong/shared';
import { ROOM_CODE_CHARS, generateRoomCode, isValidRoomCode } from '../src/roomCode';

describe('roomCode', () => {
  test('roomCode: 6 chars from allowed set; isValidRoomCode rejects O/0/I/1/L', () => {
    expect(ROOM_CODE_CHARS).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    const rng = createRng(42);
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode(rng);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
      expect(isValidRoomCode(code)).toBe(true);
    }
    // default rng (Math.random) also works
    expect(isValidRoomCode(generateRoomCode())).toBe(true);
    for (const bad of ['ABCDEO', 'ABCDE0', 'ABCDEI', 'ABCDE1', 'ABCDEL', 'ABCDE', 'ABCDEFG', 'abcdef', '', 'ABC DE']) {
      expect(isValidRoomCode(bad)).toBe(false);
    }
    expect(isValidRoomCode(42 as unknown as string)).toBe(false);
  });

  test('uses the whole alphabet', () => {
    const rng = createRng(7);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) for (const c of generateRoomCode(rng)) seen.add(c);
    expect(seen.size).toBe(ROOM_CODE_CHARS.length);
  });
});
