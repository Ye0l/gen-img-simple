import { error, text } from '@sveltejs/kit';
import { scripts } from '#lib/server/env.js';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const { content } = (await request.json()) as { content: string };
		await scripts.write(params.path, content);
	} catch (e) {
		error(400, e instanceof Error ? e.message : String(e));
	}
	return text('ok');
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await scripts.remove(params.path);
	} catch (e) {
		error(400, e instanceof Error ? e.message : String(e));
	}
	return text('ok');
};
