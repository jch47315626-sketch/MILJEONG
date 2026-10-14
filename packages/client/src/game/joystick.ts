import type { Vec } from '@miljeong/shared';
import { el } from '../ui/dom';

const RADIUS = 48; // px of knob travel for full deflection

/** Maps a pointer offset from the stick centre to a direction of length <= 1. */
export function stickVector(dx: number, dy: number): Vec {
  const len = Math.hypot(dx, dy);
  if (len < 6) return { x: 0, y: 0 }; // dead zone
  const k = Math.min(1, len / RADIUS) / len;
  return { x: dx * k, y: dy * k };
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches === true);
}

/** Virtual joystick (bottom left). `onChange(null)` when released. */
export function createJoystick(parent: HTMLElement, onChange: (v: Vec | null) => void): { destroy(): void } {
  const knob = el('div', { class: 'joystick-knob' });
  const base = el('div', { class: 'joystick', 'data-testid': 'joystick' }, knob);
  parent.append(base);
  let pointer: number | null = null;

  const move = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    const r = base.getBoundingClientRect();
    const v = stickVector(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    knob.style.transform = `translate(${v.x * RADIUS}px, ${v.y * RADIUS}px)`;
    onChange(v);
  };
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    knob.style.transform = '';
    onChange(null);
  };
  base.addEventListener('pointerdown', (e) => {
    if (pointer !== null) return;
    pointer = e.pointerId;
    base.setPointerCapture?.(e.pointerId);
    move(e);
  });
  base.addEventListener('pointermove', move);
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);

  return {
    destroy() {
      base.remove();
    },
  };
}
