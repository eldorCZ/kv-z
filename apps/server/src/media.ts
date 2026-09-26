/**
 * Custom background images of teachers (Dodatek 4, V8). Only JPEG, PNG and WebP recognised by their magic
 * bytes (never SVG, GIF or HEIC, never a URL to fetch); decoded with a 40 MP limit, turned upright by EXIF,
 * stripped of all metadata and re-encoded to WebP in three widths. Files live in MEDIA_DIR/theme/<id>/.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { Db } from './db/index.js';
import { HttpError } from './game/service.js';
import { RateLimiter } from './util.js';

export const IMAGE_SIZES = [1920, 1280, 640] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const QUOTA_BYTES = 50 * 1024 * 1024;
export const QUOTA_IMAGES = 30;
const MAX_PIXELS = 40_000_000;

export interface ThemeImage {
  id: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: number;
}

/** Format by magic bytes; anything else is refused before decoding. */
export function sniff(buf: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export class ThemeImages {
  private readonly hourly = new RateLimiter(10, 3_600_000);

  constructor(
    private readonly db: Db,
    private readonly dir: string,
  ) {}

  private sql() {
    return this.db.$client;
  }

  list(teacherId: string): ThemeImage[] {
    return this.sql()
      .prepare('SELECT id, bytes, width, height, created_at AS createdAt FROM theme_images WHERE teacher_id = ? ORDER BY created_at DESC')
      .all(teacherId) as ThemeImage[];
  }

  owns(teacherId: string, id: string): boolean {
    return !!this.sql().prepare('SELECT 1 FROM theme_images WHERE id = ? AND teacher_id = ?').get(id, teacherId);
  }

  exists(id: string): boolean {
    return !!this.sql().prepare('SELECT 1 FROM theme_images WHERE id = ?').get(id);
  }

  usage(teacherId: string): { bytes: number; images: number } {
    const r = this.sql().prepare('SELECT coalesce(sum(bytes), 0) AS bytes, count(*) AS images FROM theme_images WHERE teacher_id = ?').get(teacherId) as { bytes: number; images: number };
    return r;
  }

  file(id: string, size: ImageSize): string {
    return join(this.dir, 'theme', id, `${size}.webp`);
  }

  async add(teacherId: string, input: Buffer): Promise<ThemeImage> {
    if (input.length === 0) throw new HttpError(400, 'Soubor je prázdný.', 'empty');
    if (input.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Obrázek je příliš velký (max. 15 MB).', 'too_large');
    const kind = sniff(input);
    if (!kind) throw new HttpError(415, 'Podporované jsou jen obrázky JPEG, PNG a WebP.', 'unsupported_image');
    const used = this.usage(teacherId);
    if (used.images >= QUOTA_IMAGES) throw new HttpError(409, `Máte už ${QUOTA_IMAGES} obrázků. Nejdřív nějaký smažte.`, 'quota_images');
    const wait = this.hourly.hit(teacherId);
    if (wait) throw new HttpError(429, `Obrázků lze nahrát nejvýš 10 za hodinu. Zkuste to za ${Math.ceil(wait / 60)} min.`, 'rate_limited');

    let meta: sharp.Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
    } catch {
      throw new HttpError(422, 'Obrázek nelze přečíst nebo je větší než 40 megapixelů.', 'invalid_image');
    }
    if (meta.format !== kind) throw new HttpError(415, 'Obsah souboru neodpovídá formátu obrázku.', 'unsupported_image');

    const id = randomBytes(16).toString('hex');
    const outDir = join(this.dir, 'theme', id);
    mkdirSync(outDir, { recursive: true });
    let bytes = 0;
    let width = 0;
    let height = 0;
    try {
      for (const size of IMAGE_SIZES) {
        // rotate() applies the EXIF orientation; sharp drops every metadata block unless asked to keep it
        const { data, info } = await sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' })
          .rotate()
          .resize({ width: size, withoutEnlargement: true })
          .webp({ quality: size === 640 ? 72 : 78, effort: 4 })
          .toBuffer({ resolveWithObject: true });
        writeFileSync(join(outDir, `${size}.webp`), data);
        bytes += data.length;
        if (size === 1920) ({ width, height } = info);
      }
    } catch {
      rmSync(outDir, { recursive: true, force: true });
      throw new HttpError(422, 'Obrázek se nepodařilo zpracovat.', 'invalid_image');
    }
    if (used.bytes + bytes > QUOTA_BYTES) {
      rmSync(outDir, { recursive: true, force: true });
      throw new HttpError(409, 'Na obrázky máte místo 50 MB a to je plné. Nejdřív nějaký smažte.', 'quota_bytes');
    }
    const createdAt = Date.now();
    this.sql().prepare('INSERT INTO theme_images (id, teacher_id, bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, teacherId, bytes, width, height, createdAt);
    return { id, bytes, width, height, createdAt };
  }

  /** Deletes the files and forgets the image in the teacher's quizzes and default look; running games fall back to their motive. */
  remove(teacherId: string, id: string): boolean {
    if (!this.owns(teacherId, id)) return false;
    const db = this.sql();
    db.transaction(() => {
      db.prepare('DELETE FROM theme_images WHERE id = ?').run(id);
      const strip = (json: string | null) => {
        if (!json) return json;
        const t = JSON.parse(json) as Record<string, unknown>;
        if (t.imageId !== id) return json;
        delete t.imageId;
        return Object.keys(t).length ? JSON.stringify(t) : null;
      };
      for (const q of db.prepare('SELECT id, theme_json FROM quizzes WHERE teacher_id = ? AND theme_json LIKE ?').all(teacherId, `%${id}%`) as { id: string; theme_json: string }[]) {
        db.prepare('UPDATE quizzes SET theme_json = ? WHERE id = ?').run(strip(q.theme_json), q.id);
      }
      const t = db.prepare('SELECT default_theme_json FROM teachers WHERE id = ?').get(teacherId) as { default_theme_json: string | null };
      db.prepare('UPDATE teachers SET default_theme_json = ? WHERE id = ?').run(strip(t.default_theme_json), teacherId);
    })();
    rmSync(join(this.dir, 'theme', id), { recursive: true, force: true });
    return true;
  }
}
