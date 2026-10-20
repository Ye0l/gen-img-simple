// Saved runs (replay logs) under DATA_DIR/runs. A run saved by the CLI can be
// opened in the web UI (and the other way around) because the log is the whole
// transcript: replaying it rebuilds every cell, image and log line.

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunFile } from '../runtime/core.js';

const ID = /^[\w.-]{1,120}$/;

export function createRuns(dataDir: string) {
	const root = resolve(dataDir, 'runs');
	const file = (id: string) => {
		if (!ID.test(id)) throw new Error(`invalid run id: ${id}`);
		return join(root, `${id}.json`);
	};

	return {
		root,
		async list() {
			await mkdir(root, { recursive: true });
			const out: Omit<RunFile, 'log'>[] = [];
			for (const name of await readdir(root)) {
				if (!name.endsWith('.json')) continue;
				try {
					const { log, ...meta } = JSON.parse(await readFile(join(root, name), 'utf8')) as RunFile;
					out.push({ ...meta, steps: log.filter((e) => e.kind === 'ask').length } as Omit<RunFile, 'log'>);
				} catch {
					/* skip unreadable files */
				}
			}
			return out.sort((a, b) => b.updated - a.updated);
		},
		async get(id: string): Promise<RunFile> {
			return JSON.parse(await readFile(file(id), 'utf8'));
		},
		async save(run: RunFile) {
			const path = file(run.id);
			await mkdir(root, { recursive: true });
			await writeFile(`${path}.tmp`, JSON.stringify(run), 'utf8');
			await rename(`${path}.tmp`, path);
		}
	};
}
