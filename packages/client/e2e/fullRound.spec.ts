import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { S } from '../src/strings';

const NAMES = ['P1', 'P2', 'P3', 'P4'] as const;

async function openPlayers(browser: Browser): Promise<{ contexts: BrowserContext[]; pages: Page[] }> {
  const contexts = await Promise.all(NAMES.map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  return { contexts, pages };
}

/** The vote card of the player named `name` on `page`; returns that player's id. */
async function playerIdByName(page: Page, name: string): Promise<string> {
  const card = page
    .getByTestId('meeting')
    .locator('button.vote-card')
    .filter({ has: page.locator('.vote-name', { hasText: new RegExp(`^${name}$`) }) });
  await expect(card).toHaveCount(1);
  const testId = await card.getAttribute('data-testid');
  expect(testId).toMatch(/^vote-/);
  return testId!.slice('vote-'.length);
}

test('4 players: create, join, start, bell meeting, all skip, resume; then spy ejected → fighters win', async ({ browser }) => {
  const { contexts, pages } = await openPlayers(browser);
  const [host] = pages;

  try {
    // 1. host creates a room, the others join with its code
    await Promise.all(pages.map((p) => p.goto('/')));
    await host.getByTestId('nickname').fill(NAMES[0]);
    await host.getByTestId('create').click();
    const codeEl = host.getByTestId('room-code');
    await expect(codeEl).toHaveText(/^[A-Z0-9]{6}$/);
    const code = (await codeEl.textContent())!.trim();

    for (let i = 1; i < pages.length; i++) {
      const p = pages[i];
      await p.getByTestId('nickname').fill(NAMES[i]);
      await p.getByTestId('code-input').fill(code);
      await p.getByTestId('join').click();
      await expect(p.getByTestId('room-code')).toHaveText(code);
    }
    for (const p of pages) await expect(p.getByTestId('lobby-player')).toHaveCount(4);

    await expect(host.getByTestId('start')).toBeEnabled();
    await host.getByTestId('start').click();

    // 2. role reveal on every page; exactly one spy
    const roles = await Promise.all(
      pages.map(async (p) => {
        const h = p.getByTestId('role-reveal').locator('h2');
        await expect(h).toBeVisible();
        const text = (await h.textContent())!.trim();
        expect([S.game.roleSpy, S.game.roleFighter]).toContain(text);
        return text === S.game.roleSpy ? ('spy' as const) : ('fighter' as const);
      }),
    );
    expect(roles.filter((r) => r === 'spy')).toHaveLength(1);
    for (const p of pages) {
      await expect(p.locator('[data-testid="game-screen"] canvas')).toHaveCount(1);
      await expect(p.getByTestId('game-error')).toHaveCount(0);
    }
    const spyIndex = roles.indexOf('spy');
    const spyName = NAMES[spyIndex];

    // 3. spawns ring the bell: once bellUnlockMs passes the bell is usable without moving
    const bell1 = host.getByTestId('btn-bell');
    await expect(bell1).toBeEnabled();
    await bell1.click();
    for (const p of pages) await expect(p.getByTestId('meeting')).toBeVisible();

    // 4. everybody skips → nobody ejected → back to playing
    await Promise.all(pages.map((p) => p.getByTestId('vote-skip').click()));
    for (const p of pages) {
      await expect(p.getByTestId('ejection-text')).toHaveText(S.meeting.noEject);
    }
    for (const p of pages) {
      await expect(p.getByTestId('meeting')).toBeHidden();
      await expect(p.getByTestId('ejection')).toBeHidden();
    }

    // 5. a different player rings the bell (bell is once per player)
    const bell2 = pages[1].getByTestId('btn-bell');
    await expect(bell2).toBeEnabled();
    await bell2.click();
    for (const p of pages) await expect(p.getByTestId('meeting')).toBeVisible();

    const spyId = await playerIdByName(host, spyName);
    await Promise.all(
      pages.map((p, i) =>
        i === spyIndex ? p.getByTestId('vote-skip').click() : p.getByTestId(`vote-${spyId}`).click(),
      ),
    );

    for (const p of pages) {
      await expect(p.getByTestId('result')).toBeVisible();
      await expect(p.getByTestId('result-winner')).toHaveText(S.result.fightersWin);
    }

    // 6. host takes everybody back to the lobby
    await expect(host.getByTestId('back-to-lobby')).toBeVisible();
    for (const p of pages.slice(1)) await expect(p.getByTestId('back-to-lobby')).toHaveCount(0);
    await host.getByTestId('back-to-lobby').click();
    for (const p of pages) {
      await expect(p.getByTestId('room-code')).toHaveText(code);
      await expect(p.getByTestId('lobby-player')).toHaveCount(4);
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
