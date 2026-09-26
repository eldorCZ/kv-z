import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiToken, startApp, teacher, ui, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => t.close());

describe('appearance preferences of teachers (Dodatek 4, V5.3)', () => {
  it('defaults, saving, sanitising and returning them after login', async () => {
    const s = await teacher(t, 'vzhled@skola.cz');
    const me = await t.http.get('/api/auth/me').set('cookie', s.cookie);
    expect(me.body.uiPrefs).toEqual({ scheme: 'system', motion: 'system', font: 'default' });
    const put = await t.http.put('/api/auth/prefs').set(ui(s)).send({ scheme: 'dark', motion: 'reduce', font: 'readable', extra: 'x' });
    expect(put.body.uiPrefs).toEqual({ scheme: 'dark', motion: 'reduce', font: 'readable' });
    const bad = await t.http.put('/api/auth/prefs').set(ui(s)).send({ scheme: 'purple', motion: 42 });
    expect(bad.body.uiPrefs).toEqual({ scheme: 'system', motion: 'system', font: 'default' });
    await t.http.put('/api/auth/prefs').set(ui(s)).send({ scheme: 'light' });
    const login = await t.http.post('/api/auth/login').send({ email: 'vzhled@skola.cz', password: 'tajneheslo123' });
    expect(login.body.uiPrefs).toMatchObject({ scheme: 'light' });
  });

  it('needs a session with CSRF; API tokens cannot change it', async () => {
    const s = await teacher(t);
    expect((await t.http.put('/api/auth/prefs').set('cookie', s.cookie).send({ scheme: 'dark' })).status).toBe(403);
    const tok = (await apiToken(t, s)).token;
    expect((await t.http.put('/api/auth/prefs').set('authorization', `Bearer ${tok}`).send({ scheme: 'dark' })).status).toBe(403);
    expect((await t.http.put('/api/auth/prefs').send({ scheme: 'dark' })).status).toBe(401);
  });

  it('config tells the product name (APP_NAME, default Lore)', async () => {
    expect((await t.http.get('/api/auth/config')).body.appName).toBe('Lore');
    const t2 = await startApp({ appName: 'Školní kvíz' });
    try {
      expect((await t2.http.get('/api/auth/config')).body.appName).toBe('Školní kvíz');
    } finally {
      await t2.close();
    }
  });
});
