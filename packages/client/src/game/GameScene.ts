// The ONLY file importing phaser: tests never import it.
import Phaser from 'phaser';
import { MAP } from '@miljeong/shared';
import { blockedTiles, COLORS, needsVisionOverlay, PLAYER_DRAW_RADIUS, PositionTracker, TILE } from './render';
import type { GameStore } from './store';

const DEPTH = { zones: 1, marks: 2, players: 3, names: 4, overlay: 10 } as const;

class GameScene extends Phaser.Scene {
  private tracker = new PositionTracker();
  private seenSeq = -1;
  private marks!: Phaser.GameObjects.Graphics;
  private maskShape!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private names = new Map<string, Phaser.GameObjects.Text>();

  constructor(private readonly store: GameStore) {
    super('game');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.background);

    const ground = this.add.graphics();
    for (let y = 0; y < MAP.height; y++) {
      for (let x = 0; x < MAP.width; x++) {
        const wall = MAP.tiles[y][x] !== '.';
        ground.fillStyle(wall ? COLORS.wall : (x + y) % 2 === 0 ? COLORS.floor : COLORS.floorAlt, 1);
        ground.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    for (const z of MAP.zones) {
      this.add
        .text((z.rect.x + z.rect.w / 2) * TILE, (z.rect.y + 0.4) * TILE, z.name, {
          fontSize: '14px',
          color: COLORS.zoneLabel,
        })
        .setOrigin(0.5, 0)
        .setAlpha(0.8)
        .setDepth(DEPTH.zones);
    }

    this.marks = this.add.graphics().setDepth(DEPTH.marks);

    // darkness: a huge rectangle with a circular hole (inverted geometry mask) around me
    this.maskShape = this.make.graphics({}, false);
    this.overlay = this.add.graphics().setDepth(DEPTH.overlay);
    this.overlay.fillStyle(COLORS.overlay, COLORS.overlayAlpha);
    this.overlay.fillRect(-6000, -6000, MAP.width * TILE + 12000, MAP.height * TILE + 12000);
    const mask = new Phaser.Display.Masks.GeometryMask(this, this.maskShape);
    mask.setInvertAlpha(true);
    this.overlay.setMask(mask);
  }

  update(): void {
    const view = this.store.view;
    if (!view) return;
    const now = performance.now();

    if (this.seenSeq !== this.store.seq) {
      this.seenSeq = this.store.seq;
      this.tracker.update(
        [{ id: view.me.id, pos: view.me.pos }, ...view.visible.map((v) => ({ id: v.id, pos: v.pos }))],
        now,
      );
    }

    const me = this.tracker.at(view.me.id, now) ?? view.me.pos;
    const cam = this.cameras.main;
    cam.centerOn(Math.round(me.x * TILE), Math.round(me.y * TILE));

    const g = this.marks;
    g.clear();

    // bell and breaker
    g.fillStyle(COLORS.bell, 1).fillCircle(MAP.bell.x * TILE, MAP.bell.y * TILE, 8);
    g.fillStyle(COLORS.breaker, 1).fillRect(MAP.breaker.x * TILE - 7, MAP.breaker.y * TILE - 7, 14, 14);

    // active checkpoint: the passage tiles are blocked (red fill + hatch)
    for (const t of blockedTiles(view.sabotage, MAP)) {
      const x0 = Math.floor(t.x) * TILE;
      const y0 = Math.floor(t.y) * TILE;
      g.fillStyle(COLORS.checkpoint, 0.45).fillRect(x0, y0, TILE, TILE);
      g.lineStyle(2, COLORS.checkpoint, 0.9);
      g.lineBetween(x0, y0 + TILE, x0 + TILE, y0).lineBetween(x0, y0 + TILE / 2, x0 + TILE / 2, y0);
      g.lineBetween(x0 + TILE / 2, y0 + TILE, x0 + TILE, y0 + TILE / 2);
      g.strokeRect(x0, y0, TILE, TILE);
    }

    // task spots: only my unfinished tasks are highlighted
    const mine = new Set(view.me.tasks.filter((t) => !t.done).map((t) => t.taskId));
    for (const s of MAP.taskSpots) {
      const px = s.pos.x * TILE;
      const py = s.pos.y * TILE;
      if (mine.has(s.id)) {
        g.lineStyle(3, COLORS.taskActive, 1).strokeCircle(px, py, 13);
        g.fillStyle(COLORS.taskActive, 0.8).fillCircle(px, py, 6);
      } else {
        g.fillStyle(COLORS.taskDim, 0.6).fillCircle(px, py, 4);
      }
    }

    // traces: red cross
    g.lineStyle(4, COLORS.trace, 1);
    for (const t of view.traces) {
      const px = t.pos.x * TILE;
      const py = t.pos.y * TILE;
      g.lineBetween(px - 8, py - 8, px + 8, py + 8).lineBetween(px - 8, py + 8, px + 8, py - 8);
    }

    // players
    const ghostOf = new Map(view.visible.map((v) => [v.id, v.ghost]));
    const live = new Set<string>();
    for (const id of this.tracker.ids()) {
      const p = this.tracker.at(id, now);
      if (!p) continue;
      live.add(id);
      const self = id === view.me.id;
      const ghost = self ? !view.me.alive : (ghostOf.get(id) ?? false);
      const mate = !self && view.me.fellowSpies.includes(id);
      const color = ghost ? COLORS.ghost : self ? COLORS.me : mate ? COLORS.spyMate : COLORS.other;
      const px = p.x * TILE;
      const py = p.y * TILE;
      g.fillStyle(color, ghost ? 0.45 : 1).fillCircle(px, py, PLAYER_DRAW_RADIUS);
      g.lineStyle(2, COLORS.outline, ghost ? 0.4 : 1).strokeCircle(px, py, PLAYER_DRAW_RADIUS);

      let label = this.names.get(id);
      if (!label) {
        label = this.add.text(0, 0, '', { fontSize: '12px', color: COLORS.name, stroke: '#000', strokeThickness: 3 });
        label.setOrigin(0.5, 1).setDepth(DEPTH.names);
        this.names.set(id, label);
      }
      label.setText(view.roster.find((r) => r.id === id)?.name ?? '');
      label.setPosition(px, py - PLAYER_DRAW_RADIUS - 2);
      label.setAlpha(ghost ? 0.5 : 1);
    }
    for (const [id, label] of this.names) {
      if (!live.has(id)) {
        label.destroy();
        this.names.delete(id);
      }
    }

    // vision
    const dark = needsVisionOverlay(view.visionRadius, MAP);
    this.overlay.setVisible(dark);
    if (dark) {
      this.maskShape.clear();
      this.maskShape.fillStyle(0xffffff, 1).fillCircle(me.x * TILE, me.y * TILE, view.visionRadius * TILE);
    }
  }
}

export function createGame(container: HTMLElement, store: GameStore): { destroy(): void } {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    backgroundColor: '#0b0906',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [new GameScene(store)],
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    audio: { noAudio: true },
    banner: false,
  });
  return {
    destroy() {
      game.destroy(true);
    },
  };
}
