import type { Rng } from '@miljeong/shared';

/** Room code alphabet: no 0, O, 1, I, L (easily confused). */
export const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

const VALID = new RegExp(`^[${ROOM_CODE_CHARS}]{${ROOM_CODE_LENGTH}}$`);

export function generateRoomCode(rng?: Pick<Rng, 'int'>): string {
  const int = rng ? (n: number) => rng.int(n) : (n: number) => Math.floor(Math.random() * n);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_CHARS[int(ROOM_CODE_CHARS.length)];
  return code;
}

export function isValidRoomCode(s: unknown): s is string {
  return typeof s === 'string' && VALID.test(s);
}
