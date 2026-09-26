import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiToken, startApp, teacher, ui, type TestApp } from './helpers.js';
import { connect, emit, type Client } from './socket-helpers.js';

let t: TestApp;
let sess: { cookie: string; csrf: string };

const jpegWithExif = () =>
  sharp({ create: { width: 800, height: 400, channels: 3, background: '#3366cc' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Artist: 'Tajný autor', Copyright: 'GPS 50.08N 14.42E' } })
    .toBuffer();
const png = (w = 300, h = 200) => sharp({ create: { width: w, height: h, channels: 3, background: '#22aa66' } }).png().toBuffer();

const upload = (body: Buffer, s = sess, type = 'image/jpeg') => t.http.post('/api/theme-images').set(ui(s)).set('content-type', type).send(body);

beforeAll(async () => {
  t = await startApp({ apiRateLimit: 10_000 });
  sess = await teacher(t);
});
afterAll(async () => t.close());

describe('custom background images (Dodatek 4, V8)', () => {
  it('re-encodes to WebP in three widths, applies EXIF orientation and strips metadata', async () => {
    const r = await upload(await jpegWithExif());
    expect(r.status).toBe(201);
    expect(r.body.id).toMatch(/^[0-9a-f]{32}$/);
    // Orientation 6 = rotated: 800x400 becomes 400x800
    expect([r.body.width, r.body.height]).toEqual([400, 800]);
    for (const size of [640, 1280, 1920]) {
      const f = await t.http.get(`/media/theme/${r.body.id}/${size}.webp`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(f.status).toBe(200);
      expect(f.headers['content-type']).toBe('image/webp');
      expect(f.headers['x-content-type-options']).toBe('nosniff');
      expect(f.headers['cache-control']).toContain('immutable');
      const meta = await sharp(f.body as Buffer).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.width).toBeLessThanOrEqual(size);
      expect((f.body as Buffer).toString('latin1')).not.toContain('Tajný');
    }
    const list = await t.http.get('/api/theme-images').set(ui(sess));
    expect(list.body.images[0]).toMatchObject({ id: r.body.id, url: `/media/theme/${r.body.id}/640.webp` });
    expect(list.body.quota).toEqual({ bytes: 50 * 1024 * 1024, images: 30 });
  });

  it('refuses SVG, GIF, HEIC-like and disguised files by their content', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect((await upload(svg, sess, 'image/png')).status).toBe(415);
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).gif().toBuffer();
    expect((await upload(gif, sess, 'image/jpeg')).status).toBe(415);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(32)]);
    expect((await upload(heic)).status).toBe(415);
    const fakeWebp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('not really an image')]);
    expect((await upload(fakeWebp)).status).toBe(422);
    expect((await t.http.post('/api/theme-images').set(ui(sess)).set('content-type', 'application/json').send({ url: 'http://example.com/a.jpg' })).status).toBe(415);
  });

  it('refuses images over 40 megapixels', async () => {
    const huge = await sharp({ create: { width: 8000, height: 5100, channels: 3, background: '#ffffff' } }).png({ compressionLevel: 9 }).toBuffer();
    const r = await upload(huge, sess, 'image/png');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('invalid_image');
  });

  it('only the own session with CSRF may upload; API tokens cannot', async () => {
    const body = await png();
    expect((await t.http.post('/api/theme-images').set('cookie', sess.cookie).set('content-type', 'image/png').send(body)).status).toBe(403);
    const tok = (await apiToken(t, sess)).token;
    expect((await t.http.post('/api/theme-images').set('authorization', `Bearer ${tok}`).set('content-type', 'image/png').send(body)).status).toBe(403);
    expect((await t.http.get('/api/theme-images').set('authorization', `Bearer ${tok}`)).status).toBe(403);
  });

  it('limits uploads to 10 per hour and 30 images per teacher', async () => {
    const s2 = await teacher(t);
    const body = await png(64, 64);
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await upload(body, s2, 'image/png')).status);
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);

    const s3 = await teacher(t);
    const tid = (await t.http.get('/api/auth/me').set('cookie', s3.cookie)).body.teacher.id;
    const ins = t.services.db.$client.prepare('INSERT INTO theme_images (id, teacher_id, bytes, width, height, created_at) VALUES (?, ?, 1, 1, 1, 0)');
    for (let i = 0; i < 30; i++) ins.run(`${i}`.padStart(32, 'a'), tid);
    const full = await upload(body, s3, 'image/png');
    expect(full.status).toBe(409);
    expect(full.body.code).toBe('quota_images');
  });

  it('a quiz uses only its own images; players get the image URL with the strong scrim; delete falls back', async () => {
    const img = (await upload(await png())).body.id as string;
    const other = await teacher(t);
    const foreign = (await upload(await png(), other, 'image/png')).body.id as string;
    const quiz = { schemaVersion: 1, title: 'Fotka', questions: [{ type: 'single', prompt: 'Kolik je 1 + 1?', options: ['2', '3', '4'], correctIndices: [0] }] };
    const q = (await t.http.post('/api/v1/quizzes').set(ui(sess)).send({ ...quiz, theme: { motive: 'les', imageId: img } })).body;
    expect(q.warnings).toBeUndefined();
    const stolen = await t.http.post('/api/v1/quizzes').set(ui(sess)).send({ ...quiz, theme: { motive: 'les', imageId: foreign } });
    expect(stolen.body.warnings[0].code).toBe('unknown_image');

    const g = (await t.http.post(`/api/v1/quizzes/${q.quizId}/games`).set(ui(sess)).send({ mode: 'live' })).body;
    const p: Client = await connect(t.url);
    const joined = await emit<{ theme: Record<string, unknown> }>(p, 'join', { pin: g.pin, nickname: 'novak12' });
    expect(joined.theme).toEqual({ motive: 'les', accent: null, imageUrl: `/media/theme/${img}/1280.webp`, scrimHint: 'strong' });
    p.disconnect();

    expect((await t.http.delete(`/api/theme-images/${foreign}`).set(ui(sess))).status).toBe(404);
    expect((await t.http.delete(`/api/theme-images/${img}`).set(ui(sess))).status).toBe(204);
    expect((await t.http.get(`/api/v1/quizzes/${q.quizId}`).set(ui(sess))).body.theme).toEqual({ motive: 'les' });
    expect((await t.http.get(`/media/theme/${img}/640.webp`)).status).toBe(404);
    expect((await t.http.get('/media/theme/../../etc/passwd')).status).toBe(404);
  });
});
