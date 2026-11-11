// Branded share image at a stable URL: /og/projects/<slug>.jpg (1200x630).
import type { APIRoute } from 'astro';
import { join } from 'node:path';
import sharp from 'sharp';
import { getProjects } from '../../../data/projects';

export async function getStaticPaths() {
  return (await getProjects()).map((p) => ({ params: { slug: p.slug } }));
}

export const GET: APIRoute = async ({ params }) => {
  const file = join(process.cwd(), 'src/assets/projects', params.slug as string, 'og-branded.jpg');
  const body = await sharp(file).resize(1200, 630, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'image/jpeg' } });
};
