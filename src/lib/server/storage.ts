// Persistent storage for scripts:
// - secrets: write-only from the browser. Values stay on the server and are
//   substituted into proxied http requests via {{secret:name}} placeholders.
// - text: plain name -> string entries, readable and writable from scripts.
// Both are small JSON files under DATA_DIR.

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DATA_DIR } from '$app/env/private';

const root = resolve(DATA_DIR);
const NAME = /^[\w.\-/]{1,200}$/;

export function checkName(name: string) {
	if (!NAME.test(name) || name.includes('..')) throw new Error(`invalid name: ${name}`);
	return name;
}

async function load(file: string): Promise<Record<string, string>> {
	try {
		return JSON.parse(await readFile(join(root, file), 'utf8'));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw e;
	}
}

// writes are serialized per file so concurrent PUTs can't drop each other's entries
const queues = new Map<string, Promise<unknown>>();
function update(file: string, fn: (data: Record<string, string>) => void, mode?: number) {
	const run = async () => {
		const data = await load(file);
		fn(data);
		await mkdir(root, { recursive: true });
		const tmp = join(root, `.${file}.tmp`);
		await writeFile(tmp, JSON.stringify(data, null, '\t'), { encoding: 'utf8', mode });
		if (mode) await chmod(tmp, mode);
		await rename(tmp, join(root, file));
	};
	const next = (queues.get(file) ?? Promise.resolve()).then(run, run);
	queues.set(file, next);
	return next;
}

export const secrets = {
	names: async () => Object.keys(await load('secrets.json')).sort(),
	all: () => load('secrets.json'),
	set: (name: string, value: string) =>
		update('secrets.json', (d) => void (d[checkName(name)] = value), 0o600),
	delete: (name: string) => update('secrets.json', (d) => void delete d[checkName(name)], 0o600)
};

export const texts = {
	all: () => load('text.json'),
	set: (name: string, value: string) => update('text.json', (d) => void (d[checkName(name)] = value)),
	delete: (name: string) => update('text.json', (d) => void delete d[checkName(name)])
};

/** replace {{secret:name}} in a string; throws when a referenced secret is missing */
export function fillSecrets(s: string, all: Record<string, string>) {
	return s.replace(/\{\{secret:([\w.\-/]+)\}\}/g, (_, name: string) => {
		if (!(name in all)) throw new Error(`secret not set: ${name}`);
		return all[name];
	});
}
