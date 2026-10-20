import { json } from '@sveltejs/kit';
import { runs } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json({ runs: await runs.list() });
