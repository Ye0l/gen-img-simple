// Script files (init.lua, functions/, flows/) on disk. Plain node, no SvelteKit
// imports, so the CLI uses the same code.

import { readdir, readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

export function createScripts(dir: string) {
	const root = resolve(dir);

	/** maps a client path to an absolute path, refusing anything outside root */
	const safePath = (path: string) => {
		const abs = resolve(root, path);
		if (!abs.startsWith(root + sep) || !abs.endsWith('.lua')) throw new Error(`invalid script path: ${path}`);
		return abs;
	};

	return {
		root,
		async readAll(): Promise<Record<string, string>> {
			const out: Record<string, string> = {};
			const walk = async (d: string) => {
				for (const e of await readdir(d, { withFileTypes: true })) {
					const abs = join(d, e.name);
					if (e.isDirectory()) await walk(abs);
					else if (e.name.endsWith('.lua')) out[relative(root, abs).split(sep).join('/')] = await readFile(abs, 'utf8');
				}
			};
			await mkdir(root, { recursive: true });
			await walk(root);
			return out;
		},
		async write(path: string, content: string) {
			const abs = safePath(path);
			await mkdir(dirname(abs), { recursive: true });
			await writeFile(abs, content, 'utf8');
		},
		async remove(path: string) {
			await unlink(safePath(path));
		}
	};
}
