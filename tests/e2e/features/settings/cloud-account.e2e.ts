import { test, expect } from '../../fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { invokeBridge } from '../../helpers/bridge';
import { selectAssistantForBackend, sendMessageFromGuid } from '../../helpers/conversation';
import { goToGuid } from '../../helpers/navigation';

// This test requires the real isolated native gateway host. It must never
// discover a provider or reuse an existing account/profile.
test.skip(!process.env.NATIVE_DESKTOP_FIXTURE_DIR, 'requires the opt-in real native gateway host');

test('native account, payment and inference use the real isolated gateway', async ({ electronApp, page }) => {
  test.setTimeout(180_000);
  const evidence = process.env.NATIVE_DESKTOP_FIXTURE_DIR;
  if (!evidence) throw new Error('NATIVE_DESKTOP_FIXTURE_DIR is required');
  const endpoint = fs.readFileSync(path.join(evidence, 'endpoint'), 'utf8');
  if (!endpoint.startsWith('http://127.0.0.1:')) throw new Error('isolated loopback gateway required');
  await electronApp.evaluate(({ shell }) => {
    const recorder: string[] = [];
    Object.assign(globalThis, { task8Checkout: recorder });
    shell.openExternal = async (url: string) => {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/submit.php')
        throw new Error('fixture checkout rejected');
      recorder.push(parsed.origin + parsed.pathname);
    };
  });
  await expect.poll(() => page.evaluate(() => typeof window.__backendPort)).toBe('number');
  await page.evaluate(async () => {
    localStorage.setItem('i18nextLng', 'en-US');
    localStorage.setItem('login-modal-skipped', '1');
    const port = window.__backendPort;
    const response = await fetch(`http://127.0.0.1:${port}/api/settings/client`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'en-US' }),
    });
    if (!response.ok) throw new Error('Failed to configure fixture language');
  });
  await page.reload();
  await page.evaluate(() => {
    window.location.hash = '#/settings/cloud-account';
  });
  fs.writeFileSync(path.join(evidence, 'desktop-initial-state.txt'), await page.locator('body').innerText());
  await page.screenshot({ path: path.join(evidence, 'desktop-initial.png'), fullPage: true });
  const account = page.getByRole('region', { name: 'Cloud account', exact: true });
  await expect(account).toBeVisible();
  await account.getByRole('button', { name: 'Register', exact: true }).click();
  const username = `desktop${Date.now().toString().slice(-10)}`;
  await account.getByLabel('Username', { exact: true }).fill(username);
  await account.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await account.getByLabel('Confirm password', { exact: true }).fill('synthetic-password');
  await account.getByText('I understand that I am creating a cloud service account.', { exact: true }).click();
  await account.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(account.getByText('Account created. Sign in separately to connect.')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'desktop-registered.png'), fullPage: true });
  await account.getByLabel('Username', { exact: true }).fill(username);
  await account.getByLabel('Password', { exact: true }).fill('synthetic-wrong');
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(account.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(account.locator('.arco-alert-error')).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'desktop-login-error.png'), fullPage: true });
  await account.getByLabel('Username', { exact: true }).fill(username);
  await account.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await account.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(account.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(account.getByText('fixture-chat', { exact: true })).toBeVisible();
  await expect(account.getByText('fixture-responses', { exact: true })).toBeVisible();
  await account.getByRole('tab', { name: 'Top up', exact: true }).click();
  await account.locator('label.arco-radio').first().click();
  await page.screenshot({ path: path.join(evidence, 'desktop-wallet-catalog-quote.png'), fullPage: true });
  const before = await (await fetch(endpoint + '/_fixture/observations')).json();
  await account.getByRole('button', { name: 'Confirm purchase', exact: true }).click();
  await expect
    .poll(async () =>
      electronApp.evaluate(() => (globalThis as typeof globalThis & { task8Checkout: string[] }).task8Checkout.length)
    )
    .toBe(1);
  const pending = await (await fetch(endpoint + '/_fixture/observations')).json();
  const order = pending.terms.find(
    (value: { UserID: number }) =>
      value.UserID === pending.users.find((value: { Username: string }) => value.Username === username).ID
  );
  expect(order.PayableMinor).toBe(7300);
  expect(order.CreditedQuota).toBe(5_000_000);
  expect(pending.payment_queries).toBe(before.payment_queries);
  const user = pending.users.find((value: { Username: string }) => value.Username === username);
  expect(user.Quota).toBe(100000);
  await fetch(endpoint + '/payment/native-epay/complete');
  expect(
    (await (await fetch(endpoint + '/_fixture/observations')).json()).users.find(
      (value: { Username: string }) => value.Username === username
    ).Quota
  ).toBe(100000);
  expect(await (await fetch(endpoint + '/_fixture/pay/' + order.TradeNo, { method: 'POST' })).text()).toBe('success');
  expect(await (await fetch(endpoint + '/_fixture/pay/' + order.TradeNo, { method: 'POST' })).text()).toBe('success');
  await expect
    .poll(
      async () =>
        (await (await fetch(endpoint + '/_fixture/observations')).json()).users.find(
          (value: { Username: string }) => value.Username === username
        ).Quota
    )
    .toBe(5100000);
  const paid = await (await fetch(endpoint + '/_fixture/observations')).json();
  expect(paid.payment_queries - pending.payment_queries).toBe(1);
  fs.writeFileSync(
    path.join(evidence, 'desktop-money-observations.json'),
    JSON.stringify(
      {
        username,
        before: user,
        terms: order,
        after: paid.users.find((value: { Username: string }) => value.Username === username),
        payment_queries: paid.payment_queries - pending.payment_queries,
      },
      null,
      2
    )
  );
  await account.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.screenshot({ path: path.join(evidence, 'desktop-paid.png'), fullPage: true });
  await fetch(endpoint + '/_fixture/scenario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Mode: 'text' }),
  });
  await goToGuid(page);
  expect(await selectAssistantForBackend(page, 'aionrs')).not.toBeNull();
  await page.getByTestId('guid-model-selector').hover();
  await page
    .getByRole('menuitem')
    .filter({ hasText: /^fixture-chat$/ })
    .click();
  await expect(page.getByTestId('guid-model-selector')).toContainText('fixture-chat');
  const conversation = await sendMessageFromGuid(page, 'Reply SYNTHETIC OK');
  await expect(page.getByText('SYNTHETIC OK', { exact: true }).last()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        (await (await fetch(endpoint + '/_fixture/observations')).json()).users.find(
          (value: { Username: string }) => value.Username === username
        ).Quota
    )
    .toBe(5099000);
  const settled = await (await fetch(endpoint + '/_fixture/observations')).json();
  expect(settled.supplier_attempts - paid.supplier_attempts).toBe(1);
  expect(settled.calls.at(-1).model).toBe('fixture-chat');
  expect(settled.users.find((value: { Username: string }) => value.Username === username).UsedQuota).toBe(1000);
  expect(settled.users.find((value: { Username: string }) => value.Username === username).RequestCount).toBe(1);
  const actor = settled.users.find((value: { Username: string }) => value.Username === username);
  const session = settled.sessions.find((value: { UserId: number }) => value.UserId === actor.ID);
  const token = settled.tokens.find((value: { Id: number }) => value.Id === session.InferenceTokenID);
  expect(token.UserId).toBe(actor.ID);
  expect(token.UsedQuota).toBe(1000);
  const consumes = settled.logs.filter(
    (value: { user_id: number; type: number }) => value.user_id === actor.ID && value.type === 2
  );
  expect(consumes).toHaveLength(1);
  expect(consumes[0].quota).toBe(1000);
  expect(consumes[0].token_id).toBe(token.Id);
  fs.writeFileSync(
    path.join(evidence, 'desktop-inference-observations.json'),
    JSON.stringify(
      {
        username,
        conversation,
        user: settled.users.find((value: { Username: string }) => value.Username === username),
        attempts: settled.supplier_attempts - paid.supplier_attempts,
        request: {
          model: settled.incoming.at(-1).model,
          stream: settled.incoming.at(-1).stream,
          tools: settled.incoming.at(-1).tools?.length ?? 0,
        },
      },
      null,
      2
    )
  );
  await page.screenshot({ path: path.join(evidence, 'desktop-conversation.png'), fullPage: true });
  await page.evaluate(() => {
    window.location.hash = '#/settings/cloud-account';
  });
  await page.setViewportSize({ width: 480, height: 800 });
  await expect(account).toBeVisible();
  await account.getByRole('tab', { name: 'Overview', exact: true }).click();
  await account.getByRole('button', { name: 'Refresh balance', exact: true }).click();
  await expect(
    account.getByRole('region', { name: 'Account balance', exact: true }).getByText('10.198 USD')
  ).toBeVisible();
  await account.getByRole('tab', { name: 'Activity', exact: true }).click();
  const activity = account.getByRole('region', { name: 'Account activity', exact: true });
  await expect(activity.getByText('0.002 USD', { exact: true })).toBeVisible();
  await expect(activity.getByText('1000 account units', { exact: true })).not.toBeVisible();
  await activity.getByText('Details', { exact: true }).click();
  await expect(activity.getByText(consumes[0].request_id, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await account.getByRole('button', { name: 'Disconnect', exact: true }).focus();
  await expect(account.getByRole('button', { name: 'Disconnect', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  await page.screenshot({ path: path.join(evidence, 'desktop-narrow-keyboard.png'), fullPage: true });
  const web = await invokeBridge<{ port: number; localUrl: string; initialPassword?: string }>(page, 'webui.start', {
    port: 26978,
    allowRemote: false,
  });
  expect(web.localUrl).toBe('http://127.0.0.1:26978');
  if (!web.initialPassword) throw new Error('fresh local WebUI password required');
  const local = await invokeBridge<{ adminUsername: string }>(page, 'webui.get-status');
  const browser = await chromium.launch({ headless: true });
  const browserPage = await browser.newPage({ viewport: { width: 480, height: 800 } });
  try {
    await browserPage.goto(web.localUrl);
    await expect(browserPage.locator('#username')).toBeVisible();
    await browserPage.screenshot({ path: path.join(evidence, 'browser-local-login.png'), fullPage: true });
    await browserPage.locator('#username').fill(local.adminUsername);
    await browserPage.locator('#password').fill(web.initialPassword);
    await browserPage.locator('button[type="submit"]').click();
    await expect(browserPage.locator('#password')).not.toBeVisible();
    await expect.poll(() => browserPage.evaluate(() => location.hash)).toBe('#/guid');
    // LoginPage also owns a 600ms success navigation after its auth effect.
    // Finish that existing transition before deliberately leaving Guid.
    await browserPage.waitForTimeout(650);
    await expect.poll(() => browserPage.evaluate(() => location.hash)).toBe('#/guid');
    await browserPage.screenshot({ path: path.join(evidence, 'browser-local-signed-in.png'), fullPage: true });
    await browserPage.goto(web.localUrl + '/#/settings/cloud-account');
    const browserAccount = browserPage.getByRole('region', { name: 'Cloud account', exact: true });
    await expect(browserAccount.getByText(username, { exact: true })).toBeVisible();
    await expect(
      browserAccount.getByRole('region', { name: 'Account balance', exact: true }).getByText('10.198 USD')
    ).toBeVisible();
    await browserAccount.getByRole('tab', { name: 'Activity', exact: true }).click();
    const browserActivity = browserAccount.getByRole('region', { name: 'Account activity', exact: true });
    await expect(browserActivity.getByText('0.002 USD', { exact: true })).toBeVisible();
    await browserActivity.getByText('Details', { exact: true }).click();
    await expect(browserActivity.getByText(consumes[0].request_id, { exact: true })).toBeVisible();
    expect(await browserPage.evaluate(() => typeof window.electronAPI)).toBe('undefined');
    expect(await browserPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await browserAccount.getByRole('button', { name: 'Disconnect', exact: true }).focus();
    await expect(browserAccount.getByRole('button', { name: 'Disconnect', exact: true })).toBeFocused();
    await browserPage.keyboard.press('Tab');
    expect(await browserPage.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await browserPage.screenshot({ path: path.join(evidence, 'browser-account-narrow-keyboard.png'), fullPage: true });
  } finally {
    fs.writeFileSync(path.join(evidence, 'browser-final-state.txt'), await browserPage.locator('body').innerText());
    fs.writeFileSync(
      path.join(evidence, 'browser-session-state.json'),
      JSON.stringify(
        await browserPage.evaluate(async () => {
          const res = await fetch('/api/cloud-account/session');
          return { status: res.status, body: await res.json() };
        }),
        null,
        2
      )
    );
    await browserPage.screenshot({ path: path.join(evidence, 'browser-final.png'), fullPage: true });
    await browser.close();
    await invokeBridge(page, 'webui.stop');
  }
  await account.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(account.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(
    account.getByText('Disconnected locally. Remote revocation is confirmed or was not needed.', { exact: true })
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await fetch(endpoint + '/_fixture/observations')).json()).sessions.find(
          (value: { UserId: number }) => value.UserId === actor.ID
        ).RevokedAt
    )
    .toBeGreaterThan(0);
  const disconnected = await (await fetch(endpoint + '/_fixture/observations')).json();
  expect(
    disconnected.sessions.find((value: { UserId: number }) => value.UserId === actor.ID).RevokedAt
  ).toBeGreaterThan(0);
  expect(disconnected.tokens.find((value: { Id: number }) => value.Id === token.Id).SessionAuthorized).toBe(false);
  const revokedProbe = await (await fetch(endpoint + '/_fixture/probe-token/' + token.Id, { method: 'POST' })).json();
  expect(revokedProbe).toEqual({
    status: 401,
    supplier_delta: 0,
    quota_before: 5099000,
    quota_after: 5099000,
    used_before: 1000,
    used_after: 1000,
    requests_before: 1,
    requests_after: 1,
  });
  fs.writeFileSync(
    path.join(evidence, 'desktop-final-accounting.json'),
    JSON.stringify(
      {
        actor,
        session,
        token,
        consumes,
        revoked: disconnected.sessions.find((value: { UserId: number }) => value.UserId === actor.ID),
      },
      null,
      2
    )
  );
});
