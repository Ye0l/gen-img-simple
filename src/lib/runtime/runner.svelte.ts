// Web frontend for the flow engine: turns host calls into notebook cells.
// The engine itself (replay log, Lua bridge) lives in core.ts and is shared with the CLI.

import { LuaFactory } from 'wasmoon';
import wasmUrl from 'wasmoon/dist/glue.wasm?url';
import prelude from './prelude.lua?raw';
import { scripts } from '#lib/scripts.svelte.js';
import { storage } from '#lib/storage.svelte.js';
import { views } from '#lib/views.svelte.js';
import {
	FlowRun,
	newRunId,
	plain,
	type AskKind,
	type AskOpts,
	type Backend,
	type Entry,
	type Frontend,
	type HttpRaw,
	type RunFile
} from './core.js';

export type { AskKind, AskOpts, Field, Option } from './core.js';

interface Base {
	id: number;
	/** log position when the cell was created; "re-run from here" truncates to it */
	logPos: number;
}

export type Cell = Base &
	(
		| { type: 'md' | 'note'; text: string }
		| { type: 'ask'; kind: AskKind; opts: AskOpts; answered: boolean; answer?: unknown; replayed: boolean }
		| { type: 'image'; images: { src: string; caption?: string }[] }
		| { type: 'progress'; text: string; state: 'running' | 'done' | 'error' }
		| { type: 'error'; text: string }
	);

export type AskCell = Extract<Cell, { type: 'ask' }>;

export type Status = 'idle' | 'running' | 'waiting' | 'done' | 'error' | 'stopped';

let factory: LuaFactory | null = null;
const getFactory = () => (factory ??= new LuaFactory(wasmUrl));

function blobToBase64(b: Blob) {
	return new Promise<string>((resolve, reject) => {
		const fr = new FileReader();
		fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
		fr.onerror = () => reject(fr.error);
		fr.readAsDataURL(b);
	});
}

/** browser side of the backend: everything goes through the SvelteKit api */
const backend: Backend = {
	files: () => scripts.files,
	async http(req) {
		if (req.direct) {
			const r = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
			const ct = r.headers.get('content-type') ?? '';
			const binary = /^(image|audio|video)\/|octet-stream|zip|msgpack/.test(ct);
			return {
				status: r.status,
				ok: r.ok,
				headers: Object.fromEntries(r.headers),
				body: binary ? await blobToBase64(await r.blob()) : await r.text(),
				encoding: binary ? 'base64' : 'text'
			};
		}
		const r = await fetch('/api/http', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(req)
		});
		if (!r.ok) throw new Error(`proxy error ${r.status}: ${await r.text()}`);
		return (await r.json()) as HttpRaw;
	},
	secretNames: () => storage.secrets,
	setSecret: (n, v) => storage.setSecret(n, v),
	deleteSecret: (n) => storage.deleteSecret(n),
	texts: () => storage.text,
	setText: (n, v) => storage.setText(n, v),
	deleteText: (n) => storage.deleteText(n)
};

const json = { 'content-type': 'application/json' };

class Runner {
	cells = $state<Cell[]>([]);
	status = $state<Status>('idle');
	flow = $state<string | null>(null);
	/** set while the previous log is fed back */
	replaying = $state(false);
	/** saved run this session is bound to (autosaves while set) */
	runId = $state<string | null>(null);

	private run: FlowRun | null = null;
	/** log of the last finished/abandoned run, kept for edits and saving */
	private lastLog: Entry[] = [];
	private session = 0;
	private nextId = 1;
	private created = Date.now();
	private pending = new Map<number, (v: unknown) => void>();
	private store = new Map<string, unknown>();
	private saveTimer: ReturnType<typeof setTimeout> | undefined;

	private get log() {
		return this.run?.log ?? this.lastLog;
	}

	/** run scripts/init.lua once (view setup etc.); its output is discarded */
	async boot() {
		const path = scripts.resolve('init', '.');
		if (!path) return;
		try {
			await new FlowRun({ factory: getFactory(), prelude, backend, frontend: this.frontend(), init: true }).run(path);
		} catch (e) {
			views.pushLog('error', `init.lua: ${e instanceof Error ? e.message : e}`);
		}
	}

	/** fresh run of a flow */
	start(flow: string) {
		this.session++;
		this.runId = null;
		this.created = Date.now();
		this.flow = flow;
		return this.exec([]);
	}

	/** show a saved run (e.g. from the CLI) and continue it live from where it stopped */
	async open(id: string) {
		const res = await fetch(`/api/runs/${encodeURIComponent(id)}`);
		if (!res.ok) throw new Error(`run not found: ${id}`);
		const run = (await res.json()) as RunFile;
		this.session++;
		this.runId = run.id;
		this.created = run.created;
		this.flow = run.flow;
		return this.exec(run.log);
	}

	/** bind this session to a saved run file; later changes autosave */
	async save() {
		if (!this.flow) return;
		this.runId ??= newRunId(this.flow);
		await this.persist();
	}

	/** restart and replay everything recorded (e.g. after editing a script) */
	rerun() {
		return this.rerunFrom(this.log.length);
	}

	/**
	 * restart and replay the log up to `logPos`, optionally with a replacement entry.
	 * keepLater: answers given after that point are applied again automatically
	 * (everything else after it, like generations, runs live).
	 */
	rerunFrom(logPos: number, override?: Entry, keepLater = false) {
		if (!this.flow) return;
		const log = this.log;
		const replay = log.slice(0, logPos);
		if (override) replay.push(override);
		const future = keepLater ? log.slice(replay.length).filter((e) => e.kind === 'ask') : [];
		return this.exec(replay, future, log);
	}

	answer(cell: AskCell, value: unknown) {
		const resolve = this.pending.get(cell.id);
		if (!resolve) return;
		this.pending.delete(cell.id);
		cell.answered = true;
		// secret values never go into cells or the replay log
		cell.answer = cell.kind === 'secret' ? true : value;
		this.status = 'running';
		resolve(plain(value));
	}

	/** change an already answered question -> replay up to it with the new answer */
	async edit(cell: AskCell, value: unknown, keepLater = false) {
		if (cell.kind === 'secret') {
			await storage.setSecret(cell.opts.name!, String(value));
			value = true;
		}
		return this.rerunFrom(cell.logPos, { kind: 'ask', tag: cell.kind, value: plain(value) }, keepLater);
	}

	stop() {
		this.kill();
		if (this.status === 'running' || this.status === 'waiting') this.status = 'stopped';
	}

	private kill() {
		if (this.run) this.lastLog = this.run.log;
		this.run?.kill();
		this.run = null;
		this.pending.clear();
	}

	private async exec(replay: Entry[], future: Entry[] = [], prev: Entry[] = []) {
		this.kill();
		this.cells = [];
		this.status = 'running';
		views.dropSession(this.session);

		const run = new FlowRun({
			factory: getFactory(),
			prelude,
			backend,
			frontend: this.frontend(),
			replay,
			future,
			prev,
			store: this.store,
			onEntry: () => this.scheduleSave(),
			onLive: () => (this.replaying = false)
		});
		this.run = run;
		this.replaying = run.replaying;

		const path = scripts.resolve(this.flow!, 'flows');
		try {
			if (!path) throw new Error(`flow not found: ${this.flow}`);
			await run.run(path);
			if (run.dead) return;
			this.status = 'done';
		} catch (e) {
			if (run.dead) return;
			const msg = e instanceof Error ? e.message : String(e);
			this.push({ type: 'error', text: msg });
			views.pushLog('error', msg);
			this.status = 'error';
		} finally {
			if (!run.dead) this.scheduleSave();
		}
	}

	private scheduleSave() {
		if (!this.runId) return;
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => this.persist().catch((e) => views.pushLog('error', String(e))), 400);
	}

	private async persist() {
		const run: RunFile = {
			id: this.runId!,
			flow: this.flow!,
			created: this.created,
			updated: Date.now(),
			origin: 'web',
			status: this.status,
			log: this.log
		};
		const res = await fetch(`/api/runs/${encodeURIComponent(run.id)}`, {
			method: 'PUT',
			headers: json,
			body: JSON.stringify(run)
		});
		if (!res.ok) throw new Error(`saving run failed: ${await res.text()}`);
	}

	private push(c: Record<string, unknown> & { type: Cell['type'] }, logPos = this.log.length) {
		const cell = { id: this.nextId++, logPos, ...c } as Cell;
		this.cells.push(cell);
		// return the reactive proxy, not the raw object
		return this.cells[this.cells.length - 1];
	}

	private frontend(): Frontend {
		return {
			md: (text, style) => void this.push({ type: style, text }),
			print: (level, text) => views.pushLog(level, text),
			image: (images) => {
				this.push({ type: 'image', images });
				views.pushImages(images, this.session);
			},
			progress: (text) => this.push({ type: 'progress', text, state: 'running' }).id,
			progressUpdate: (id, text, state) => {
				const c = this.cells.find((c) => c.id === id);
				if (!c || c.type !== 'progress') return;
				if (text) c.text = text;
				c.state = state;
			},
			replayed: (kind, opts, answer, logPos) =>
				void this.push({ type: 'ask', kind, opts, answered: true, answer, replayed: true }, logPos),
			ask: (kind, opts, logPos) => {
				const cell = this.push({ type: 'ask', kind, opts, answered: false, replayed: false }, logPos);
				this.status = 'waiting';
				return new Promise((resolve) => this.pending.set(cell.id, resolve));
			},
			view: (op, name, o) => views.apply(op, name, o),
			viewList: () => Object.keys(views.all)
		};
	}
}

export const runner = new Runner();
