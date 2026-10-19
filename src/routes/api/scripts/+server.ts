import { json } from '@sveltejs/kit';
import { readAll } from '#lib/server/scripts.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json({ files: await readAll() });
