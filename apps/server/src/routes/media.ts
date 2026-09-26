import { existsSync, readFileSync } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { sendError, type Services } from '../app.js';
import { IMAGE_SIZES, MAX_UPLOAD_BYTES, QUOTA_BYTES, QUOTA_IMAGES, type ImageSize } from '../media.js';

const imageUrl = (id: string, size: ImageSize = 640) => `/media/theme/${id}/${size}.webp`;

/** Upload and management of custom backgrounds (V8): only the teacher's own session, never an API token. */
export const themeImageRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    // raw image bytes; the format is decided by magic bytes, not by this header
    app.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));

    app.get('/', { config: { sessionOnly: true } }, async (req) => {
      const images = s.themeImages.list(req.auth!.teacherId).map((i) => ({ ...i, url: imageUrl(i.id) }));
      return { images, usage: s.themeImages.usage(req.auth!.teacherId), quota: { bytes: QUOTA_BYTES, images: QUOTA_IMAGES } };
    });

    app.post('/', { config: { sessionOnly: true }, bodyLimit: MAX_UPLOAD_BYTES }, async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) return sendError(reply, 415, 'Pošlete obrázek JPEG, PNG nebo WebP.', 'unsupported_image');
      const img = await s.themeImages.add(req.auth!.teacherId, req.body);
      return reply.code(201).send({ ...img, url: imageUrl(img.id) });
    });

    app.delete<{ Params: { id: string } }>('/:id', { config: { sessionOnly: true } }, async (req, reply) => {
      if (!s.themeImages.remove(req.auth!.teacherId, req.params.id)) return sendError(reply, 404, 'Obrázek nenalezen.', 'not_found');
      return reply.code(204).send();
    });
  };

/** Public, unguessable URLs for projector and phones; never sniffed, cached forever (a new image = a new id). */
export const mediaRoutes =
  (s: Services): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { id: string; file: string } }>('/theme/:id/:file', { config: { public: true }, logLevel: 'warn' }, async (req, reply) => {
      const size = Number(/^(\d+)\.webp$/.exec(req.params.file)?.[1]) as ImageSize;
      if (!/^[0-9a-f]{32}$/.test(req.params.id) || !IMAGE_SIZES.includes(size)) return sendError(reply, 404, 'Nenalezeno.', 'not_found');
      const path = s.themeImages.file(req.params.id, size);
      if (!existsSync(path)) return sendError(reply, 404, 'Nenalezeno.', 'not_found');
      return reply
        .type('image/webp')
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('content-security-policy', "default-src 'none'")
        .send(readFileSync(path));
    });
  };
