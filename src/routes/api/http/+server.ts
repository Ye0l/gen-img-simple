import { error, json } from '@sveltejs/kit';
import { allow, secrets } from '#lib/server/env.js';
import { HttpError, proxyFetch } from '#lib/server/http.js';
import type { HttpRequest } from '#lib/runtime/core.js';
import type { RequestHandler } from './$types';

// Relay for http.request() in Lua, so browser-run scripts can reach image
// backends (A1111, NovelAI, ...) without CORS trouble and use stored secrets.
// Meant for a local tool; set HTTP_ALLOW to restrict reachable hosts.

export const POST: RequestHandler = async ({ request }) => {
	const req = (await request.json()) as HttpRequest;
	try {
		return json(await proxyFetch(req, await secrets.all(), allow));
	} catch (e) {
		if (e instanceof HttpError) error(e.status, e.message);
		throw e;
	}
};
