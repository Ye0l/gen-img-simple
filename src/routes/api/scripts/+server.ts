import { json } from '@sveltejs/kit';
import { scripts } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json({ files: await scripts.readAll() });
