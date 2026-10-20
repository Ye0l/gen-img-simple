import { error, json } from '@sveltejs/kit';
import { HTTP_ALLOW as allow } from '$app/env/private';
import { fillSecrets, secrets } from '#lib/server/storage.js';
import type { RequestHandler } from './$types';

// Server-side relay for http.request() in Lua, so scripts can reach image
// backends (A1111, ComfyUI, hosted APIs) without CORS trouble.
// This is meant for a local tool; set HTTP_ALLOW (comma separated host list)
// to restrict which hosts it may reach.
// {{secret:name}} in the url, header values or body is replaced with the stored
// secret here, so secret values never reach the browser.

export const POST: RequestHandler = async ({ request }) => {
	const req = (await request.json()) as {
		url: string;
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	};
	let url: URL;
	const headers: Record<string, string> = {};
	let body: string | undefined;
	try {
		const all = await secrets.all();
		url = new URL(fillSecrets(req.url, all));
		for (const [k, v] of Object.entries(req.headers ?? {})) headers[k] = fillSecrets(String(v), all);
		body = req.body == null ? undefined : fillSecrets(req.body, all);
	} catch (e) {
		error(400, e instanceof Error ? e.message : String(e));
	}
	if (allow.length && !allow.includes(url.host)) error(403, `host not allowed: ${url.host}`);

	let res: Response;
	try {
		res = await fetch(url, { method: req.method ?? 'GET', headers, body });
	} catch (e) {
		error(502, `fetch failed: ${e instanceof Error ? e.message : e}`);
	}
	const ct = res.headers.get('content-type') ?? '';
	const binary = /^(image|audio|video)\/|octet-stream|zip|msgpack/.test(ct);
	return json({
		status: res.status,
		ok: res.ok,
		headers: Object.fromEntries(res.headers),
		body: binary ? Buffer.from(await res.arrayBuffer()).toString('base64') : await res.text(),
		encoding: binary ? 'base64' : 'text'
	});
};
