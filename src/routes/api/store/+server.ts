import { json } from '@sveltejs/kit';
import { secrets, texts } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

/** secret *names* only; values never leave the server */
export const GET: RequestHandler = async () =>
	json({ secrets: await secrets.names(), text: await texts.all() });
