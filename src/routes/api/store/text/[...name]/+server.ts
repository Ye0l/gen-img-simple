import { error, text } from '@sveltejs/kit';
import { texts } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

const fail = (e: unknown) => error(400, e instanceof Error ? e.message : String(e));

export const PUT: RequestHandler = async ({ params, request }) => {
	const { value } = (await request.json()) as { value: unknown };
	if (typeof value !== 'string') error(400, 'value must be a string');
	await texts.set(params.name, value).catch(fail);
	return text('ok');
};

export const DELETE: RequestHandler = async ({ params }) => {
	await texts.delete(params.name).catch(fail);
	return text('ok');
};
