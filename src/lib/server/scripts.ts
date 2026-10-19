import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { SCRIPTS_DIR } from '$app/env/private';

/** root folder holding init.lua, functions/ and flows/ */
export const root = resolve(SCRIPTS_DIR);

/** maps a client path to an absolute path, refusing anything outside root */
export function safePath(path: string) {
	const abs = resolve(root, path);
	if (!abs.startsWith(root + sep) || !abs.endsWith('.lua')) throw new Error(`invalid script path: ${path}`);
	return abs;
}

export async function readAll(): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	const walk = async (dir: string) => {
		for (const e of await readdir(dir, { withFileTypes: true })) {
			const abs = join(dir, e.name);
			if (e.isDirectory()) await walk(abs);
			else if (e.name.endsWith('.lua')) out[relative(root, abs).split(sep).join('/')] = await readFile(abs, 'utf8');
		}
	};
	await mkdir(root, { recursive: true });
	await walk(root);
	return out;
}

export async function write(path: string, content: string) {
	const abs = safePath(path);
	await mkdir(dirname(abs), { recursive: true });
	await writeFile(abs, content, 'utf8');
}

export async function remove(path: string) {
	await unlink(safePath(path));
}
