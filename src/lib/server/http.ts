// Server-side http for Lua's http.request(): used by /api/http (for the browser)
// and directly by the CLI. {{secret:name}} in the url, header values or body is
// replaced with the stored secret here, so secret values never reach the browser.

import type { HttpRaw, HttpRequest } from '../runtime/core.js';
import { fillSecrets } from './storage.js';

export class HttpError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

/** allow: hosts that may be reached (empty: any) */
export async function proxyFetch(req: HttpRequest, secrets: Record<string, string>, allow: string[] = []): Promise<HttpRaw> {
	let url: URL;
	const headers: Record<string, string> = {};
	let body: string | undefined;
	try {
		url = new URL(fillSecrets(req.url, secrets));
		for (const [k, v] of Object.entries(req.headers ?? {})) headers[k] = fillSecrets(String(v), secrets);
		body = req.body == null ? undefined : fillSecrets(req.body, secrets);
	} catch (e) {
		throw new HttpError(400, e instanceof Error ? e.message : String(e));
	}
	if (allow.length && !allow.includes(url.host)) throw new HttpError(403, `host not allowed: ${url.host}`);

	let res: Response;
	try {
		res = await fetch(url, { method: req.method ?? 'GET', headers, body });
	} catch (e) {
		throw new HttpError(502, `fetch failed: ${e instanceof Error ? e.message : e}`);
	}
	const ct = res.headers.get('content-type') ?? '';
	const binary = /^(image|audio|video)\/|octet-stream|zip|msgpack/.test(ct);
	return {
		status: res.status,
		ok: res.ok,
		headers: Object.fromEntries(res.headers),
		body: binary ? Buffer.from(await res.arrayBuffer()).toString('base64') : await res.text(),
		encoding: binary ? 'base64' : 'text'
	};
}
