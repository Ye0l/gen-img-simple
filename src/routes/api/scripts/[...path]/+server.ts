import { error, text } from '@sveltejs/kit';
import { remove, write } from '#lib/server/scripts.js';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const { content } = (await request.json()) as { content: string };
		await write(params.path, content);
	} catch (e) {
		error(400, e instanceof Error ? e.message : String(e));
	}
	return text('ok');
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await remove(params.path);
	} catch (e) {
		error(400, e instanceof Error ? e.message : String(e));
	}
	return text('ok');
};
