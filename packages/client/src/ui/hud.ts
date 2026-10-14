import { MAP, zoneAt, type GameConfig, type Intent, type MapData, type PlayerView, type RejectReason } from '@miljeong/shared';
import { activeConfig, availableActions, type ActionName } from '../game/input';
import { S } from '../strings';
import { el } from './dom';
import { createTaskController } from './openTask';

export interface HudDeps {
  send(intent: Intent): void;
  map?: MapData;
  config?: GameConfig;
  /** a mini-game opened or closed (the game screen stops movement while one is open) */
  onTaskOpenChange?(open: boolean): void;
}

export interface Hud {
  update(view: PlayerView): void;
  /** keyboard shortcut / button entry point, evaluated against the latest view */
  trigger(action: ActionName): void;
  toast(text: string): void;
  /** server rejected an intent: closes a pending mini-game (toast) or just toasts */
  rejected(reason: RejectReason): void;
  taskOpen(): boolean;
  destroy(): void;
}

export function rejectText(reason: RejectReason): string {
  const m = S.game.rejected;
  if (reason === 'COOLDOWN') return m.COOLDOWN;
  if (reason === 'OUT_OF_RANGE') return m.OUT_OF_RANGE;
  return m.generic;
}

function secondsLeft(readyAt: number, now: number): number {
  return Math.max(0, Math.ceil((readyAt - now) / 1000));
}

export function createHud(parent: HTMLElement, deps: HudDeps): Hud {
  const map = deps.map ?? MAP;
  const config = deps.config ?? activeConfig();
  let view: PlayerView | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const fill = el('div', { class: 'hud-gauge-fill' });
  const gaugeLabel = el('span', { class: 'hud-gauge-label' }, S.game.gauge);
  const gauge = el('div', { class: 'hud-gauge', 'data-testid': 'hud-gauge', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill, gaugeLabel);
  const tasks = el('ul', { class: 'hud-tasks', 'data-testid': 'hud-tasks' });
  const toastEl = el('div', { class: 'hud-toast', 'data-testid': 'hud-toast', hidden: true });
  const debug = import.meta.env.DEV ? el('div', { class: 'hud-debug', 'data-testid': 'debug-pos' }) : null;

  const btn = (id: string, label: string, onclick: () => void) =>
    el('button', { type: 'button', 'data-testid': id, onclick }, label);
  const bTask = btn('btn-task', S.game.btn.task, () => trigger('task'));
  const bFix = btn('btn-fix', S.game.btn.fix, () => doFix());
  const bInform = btn('btn-inform', S.game.btn.inform, () => trigger('inform'));
  const bReport = btn('btn-report', S.game.btn.report, () => trigger('report'));
  const bBell = btn('btn-bell', S.game.btn.bell, () => trigger('bell'));
  const bSab = btn('btn-sabotage', S.game.btn.sabotage, () => (menu.hidden = !menu.hidden));

  const menuBtn = (label: string, intent: Intent) =>
    el('button', { type: 'button', onclick: () => { deps.send(intent); menu.hidden = true; } }, label);
  const menu = el(
    'div',
    { class: 'hud-menu', 'data-testid': 'sabotage-menu', hidden: true },
    menuBtn(S.game.sabotageMenu.blackout, { t: 'sabotage', kind: 'blackout' }),
    ...map.passages.map((p) =>
      menuBtn(`${S.game.sabotageMenu.checkpoint}: ${p.name}`, { t: 'sabotage', kind: 'checkpoint', passageId: p.id }),
    ),
  );

  const actions = el('div', { class: 'hud-actions' }, bTask, bFix, bInform, bReport, bBell, bSab);
  const root = el('div', { class: 'hud', 'data-testid': 'hud' }, el('div', { class: 'hud-top' }, gauge, tasks), menu, actions, toastEl, debug);
  parent.append(root);
  const taskCtl = createTaskController({
    parent: root,
    send: (i) => deps.send(i),
    map,
    onOpenChange: (o) => deps.onTaskOpenChange?.(o),
  });

  function doFix(): void {
    if (view && availableActions(view, map, config).fixBreaker) deps.send({ t: 'fixBreaker' });
  }

  function trigger(action: ActionName): void {
    if (!view) return;
    const a = availableActions(view, map, config);
    switch (action) {
      case 'task':
        // E doubles as the breaker key for fighters during a blackout
        if (a.fixBreaker) doFix();
        else if (a.task) taskCtl.open(a.task, view);
        break;
      case 'inform':
        if (a.inform) deps.send({ t: 'inform', target: a.inform });
        break;
      case 'report':
        if (a.report) deps.send({ t: 'report' });
        break;
      case 'bell':
        if (a.bell) deps.send({ t: 'bell' });
        break;
    }
  }

  function renderTasks(v: PlayerView): void {
    const items: HTMLElement[] = [];
    if (v.me.role === 'spy') {
      items.push(el('li', { class: 'spy' }, S.game.noTasks));
    } else {
      for (const t of v.me.tasks) {
        const spot = map.taskSpots.find((s) => s.id === t.taskId);
        const zone = spot ? map.zones.find((z) => z.id === zoneAt(map, spot.pos))?.name : undefined;
        items.push(
          el(
            'li',
            { class: t.done ? 'done' : '', 'data-done': t.done ? 'true' : 'false' },
            `${S.game.taskNames[t.type]}${zone ? ` (${zone})` : ''}${t.done ? ` - ${S.game.taskDone}` : ''}`,
          ),
        );
      }
      if (!v.me.alive) items.push(el('li', { class: 'ghost' }, S.game.ghost));
    }
    tasks.replaceChildren(...items);
  }

  function update(v: PlayerView): void {
    view = v;
    taskCtl.onView(v);
    const spy = v.me.role === 'spy';
    const a = availableActions(v, map, config);
    const pct = Math.round(v.gauge * 100);
    fill.style.width = `${pct}%`;
    gauge.setAttribute('aria-valuenow', String(pct));
    gauge.dataset.value = String(pct);
    gaugeLabel.textContent = `${S.game.gauge} ${pct}%`;
    renderTasks(v);

    bTask.textContent = spy ? S.game.btn.camouflage : S.game.btn.task;
    bTask.disabled = a.task === null;
    bFix.hidden = spy;
    bFix.disabled = !a.fixBreaker;
    bInform.hidden = !spy;
    bInform.disabled = a.inform === null;
    bSab.hidden = !spy;
    bSab.disabled = !a.sabotage;
    if (!a.sabotage) menu.hidden = true;
    bReport.disabled = !a.report;
    bBell.disabled = !a.bell;

    if (spy) {
      const inf = secondsLeft(v.me.informReadyAt, v.now);
      bInform.textContent = inf > 0 ? `${S.game.btn.inform} ${inf}` : S.game.btn.inform;
      const sab = v.sabotageReadyAt === null ? 0 : secondsLeft(v.sabotageReadyAt, v.now);
      bSab.textContent = sab > 0 ? `${S.game.btn.sabotage} ${sab}` : S.game.btn.sabotage;
    }
    if (debug) debug.textContent = `${v.me.pos.x.toFixed(2)},${v.me.pos.y.toFixed(2)}`;
  }

  function toast(text: string): void {
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 1500);
  }

  return {
    update,
    trigger,
    toast,
    rejected(reason) {
      taskCtl.rejected();
      toast(rejectText(reason));
    },
    taskOpen: () => taskCtl.isOpen(),
    destroy() {
      taskCtl.destroy();
      clearTimeout(toastTimer);
      root.remove();
    },
  };
}
