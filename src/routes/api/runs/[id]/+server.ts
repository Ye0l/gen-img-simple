import { error, json, text } from '@sveltejs/kit';
import { runs } from '#lib/server/env.js';
import type { RunFile } from '#lib/runtime/core.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	try {
		return json(await runs.get(params.id));
	} catch {
		error(404, `run not found: ${params.id}`);
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const run = (await request.json()) as RunFile;
	if (run.id !== params.id || !Array.isArray(run.log)) error(400, 'invalid run');
	try {
		await runs.save(run);
	} catch (e) {
		error(400, e instanceof Error ? e.message : String(e));
	}
	return text('ok');
};
