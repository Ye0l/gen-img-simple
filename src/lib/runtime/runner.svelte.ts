// Runs a Lua flow and turns its host calls into notebook cells.
//
// Editing works by deterministic replay: every non-deterministic host call
// (user answers, http responses, the random seed, sleeps) is recorded in an
// ordered log. To change an earlier answer, the flow is restarted and the log
// is fed back up to that point, so earlier generations are not repeated.

import { LuaFactory, type LuaEngine } from 'wasmoon';
import wasmUrl from 'wasmoon/dist/glue.wasm?url';
import prelude from './prelude.lua?raw';
import { scripts } from '#lib/scripts.svelte.js';
import { views, type Dock } from '#lib/views.svelte.js';

export type AskKind = 'input' | 'choose' | 'multi' | 'confirm' | 'number' | 'form';

export interface Option {
	label: string;
	value: unknown;
	hint?: string;
}

export interface Field {
	name: string;
	label?: string;
	type?: 'text' | 'textarea' | 'number' | 'select' | 'checkbox';
	default?: unknown;
	options?: Option[];
	min?: number;
	max?: number;
	step?: number;
	placeholder?: string;
}

export interface AskOpts {
	label?: string;
	hint?: string;
	default?: unknown;
	placeholder?: string;
	multiline?: boolean;
	options?: Option[];
	fields?: Field[];
	min?: number;
	max?: number;
	step?: number;
	required?: boolean;
}

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

interface Entry {
	kind: 'seed' | 'ask' | 'http' | 'sleep';
	tag: string;
	value: unknown;
}

export type Status = 'idle' | 'running' | 'waiting' | 'done' | 'error' | 'stopped';

let factory: LuaFactory | null = null;
const getFactory = () => (factory ??= new LuaFactory(wasmUrl));

const never = () => new Promise<never>(() => {});
const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function normOptions(list: unknown): Option[] | undefined {
	if (!Array.isArray(list)) return undefined;
	return list.map((o) =>
		typeof o === 'object' && o !== null
			? {
					label: String((o as Option).label ?? (o as Option).value),
					value: (o as Option).value ?? (o as Option).label,
					hint: (o as Option).hint
				}
			: { label: String(o), value: o }
	);
}

function toBase64(s: string) {
	let bin = '';
	for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
	return btoa(bin);
}

async function doHttp(req: {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	json?: unknown;
	direct?: boolean;
}) {
	const headers: Record<string, string> = { ...(req.headers ?? {}) };
	let body = req.body;
	if (req.json !== undefined) {
		body = JSON.stringify(req.json);
		headers['content-type'] ??= 'application/json';
	}
	const method = req.method ?? (body ? 'POST' : 'GET');
	let out: { status: number; ok: boolean; headers: Record<string, string>; body: string; encoding: string };
	if (req.direct) {
		const r = await fetch(req.url, { method, headers, body });
		const ct = r.headers.get('content-type') ?? '';
		const binary = /^(image|audio|video)\/|octet-stream/.test(ct);
		out = {
			status: r.status,
			ok: r.ok,
			headers: Object.fromEntries(r.headers),
			body: binary ? await blobToBase64(await r.blob()) : await r.text(),
			encoding: binary ? 'base64' : 'text'
		};
	} else {
		const r = await fetch('/api/http', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ url: req.url, method, headers, body })
		});
		if (!r.ok) throw new Error(`proxy error ${r.status}: ${await r.text()}`);
		out = await r.json();
	}
	const ct = out.headers['content-type'] ?? '';
	const res: Record<string, unknown> = { status: out.status, ok: out.ok, headers: out.headers, body: out.body };
	if (out.encoding === 'base64') res.data_url = `data:${ct.split(';')[0]};base64,${out.body}`;
	else if (ct.includes('json')) {
		try {
			res.json = JSON.parse(out.body);
		} catch {
			/* not json after all */
		}
	}
	return res;
}

function blobToBase64(b: Blob) {
	return new Promise<string>((resolve, reject) => {
		const fr = new FileReader();
		fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
		fr.onerror = () => reject(fr.error);
		fr.readAsDataURL(b);
	});
}

class Runner {
	cells = $state<Cell[]>([]);
	status = $state<Status>('idle');
	flow = $state<string | null>(null);
	/** set while the previous log is fed back */
	replaying = $state(false);

	private log: Entry[] = [];
	private replay: Entry[] = [];
	/** log of the run before the current one: answers become defaults */
	private prev: Entry[] = [];
	/** later answers re-applied automatically after an edit ("run to end") */
	private future: Entry[] = [];
	private gen = 0;
	private session = 0;
	private nextId = 1;
	private engine: LuaEngine | null = null;
	private pending = new Map<number, (v: unknown) => void>();
	private store = new Map<string, unknown>();

	/** run scripts/init.lua once (view setup etc.); its cells are discarded */
	async boot() {
		const path = scripts.resolve('init', '.');
		if (!path) return;
		try {
			const engine = await getFactory().createEngine();
			engine.global.set('__host', this.host(-1, true));
			await this.loadPrelude(engine);
			await engine.doString(`__main(${JSON.stringify(path)})`);
			engine.global.close();
		} catch (e) {
			views.pushLog('error', `init.lua: ${e instanceof Error ? e.message : e}`);
		}
	}

	/** fresh run of a flow */
	start(flow: string) {
		this.session++;
		this.prev = [];
		this.flow = flow;
		return this.exec([]);
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
		const replay = this.log.slice(0, logPos);
		if (override) replay.push(override);
		const future = keepLater ? this.log.slice(replay.length).filter((e) => e.kind === 'ask') : [];
		this.prev = this.log;
		return this.exec(replay, future);
	}

	answer(cell: AskCell, value: unknown) {
		const resolve = this.pending.get(cell.id);
		if (!resolve) return;
		this.pending.delete(cell.id);
		cell.answered = true;
		cell.answer = value;
		resolve(plain(value));
	}

	/** change an already answered question -> replay up to it with the new answer */
	edit(cell: AskCell, value: unknown, keepLater = false) {
		return this.rerunFrom(cell.logPos, { kind: 'ask', tag: cell.kind, value: plain(value) }, keepLater);
	}

	stop() {
		this.kill();
		if (this.status === 'running' || this.status === 'waiting') this.status = 'stopped';
	}

	private kill() {
		this.gen++;
		this.pending.clear();
		try {
			this.engine?.global.close();
		} catch {
			/* already closed */
		}
		this.engine = null;
	}

	private async exec(replay: Entry[], future: Entry[] = []) {
		this.kill();
		const gen = this.gen;
		const flow = this.flow!;
		this.log = [];
		this.replay = replay;
		this.future = future;
		this.replaying = replay.length > 0;
		this.cells = [];
		this.status = 'running';
		views.dropSession(this.session);

		const path = scripts.resolve(flow, 'flows');
		try {
			if (!path) throw new Error(`flow not found: ${flow}`);
			const engine = await getFactory().createEngine();
			if (gen !== this.gen) return engine.global.close();
			this.engine = engine;
			engine.global.set('__host', this.host(gen, false));
			await this.loadPrelude(engine);
			await engine.doString(`__main(${JSON.stringify(path)})`);
			if (gen !== this.gen) return;
			this.status = 'done';
		} catch (e) {
			if (gen !== this.gen) return;
			const msg = e instanceof Error ? e.message : String(e);
			this.push({ type: 'error', text: msg });
			views.pushLog('error', msg);
			this.status = 'error';
		} finally {
			if (gen === this.gen) {
				this.replaying = false;
				this.engine?.global.close();
				this.engine = null;
			}
		}
	}

	private async loadPrelude(engine: LuaEngine) {
		// load() instead of doString so tracebacks say "prelude" instead of the whole source
		engine.global.set('__prelude', prelude);
		await engine.doString('local src = __prelude; __prelude = nil; assert(load(src, "@prelude"))()');
	}

	private push(c: Record<string, unknown> & { type: Cell['type'] }) {
		const cell = { id: this.nextId++, logPos: this.log.length, ...c } as Cell;
		this.cells.push(cell);
		// return the reactive proxy, not the raw object
		return this.cells[this.cells.length - 1];
	}

	/** replay-aware wrapper for anything non-deterministic */
	private async record<T>(gen: number, kind: Entry['kind'], tag: string, live: () => Promise<T>): Promise<T> {
		const r = this.takeReplay(kind, tag);
		if (r) return r.value as T;
		this.replaying = false;
		const value = await live();
		if (gen !== this.gen) return never();
		this.log.push({ kind, tag, value });
		return value;
	}

	private takeReplay(kind: Entry['kind'], tag: string): Entry | null {
		const i = this.log.length;
		const r = this.replay[i];
		if (r && r.kind === kind && r.tag === tag) {
			this.log.push(r);
			return r;
		}
		// script changed shape: stop replaying from here on
		if (r) this.replay = this.replay.slice(0, i);
		return null;
	}

	private host(gen: number, init: boolean) {
		const alive = () => init || gen === this.gen;
		const out = (c: Record<string, unknown> & { type: Cell['type'] }) => {
			if (alive() && !init) this.push(c);
		};

		return {
			md: (text: string) => out({ type: 'md', text }),
			note: (text: string) => out({ type: 'note', text }),
			print: (level: string, text: string) => alive() && views.pushLog(level, text),
			image: (list: { src: string; caption?: string }[]) => {
				if (!alive()) return;
				const images = (Array.isArray(list) ? list : []).filter((i) => i && i.src);
				out({ type: 'image', images });
				if (!init) views.pushImages(images, this.session);
			},
			progress: (text: string) => {
				if (init || !alive()) return 0;
				return this.push({ type: 'progress', text, state: 'running' }).id;
			},
			progress_update: (id: number, text: string | undefined, state: 'running' | 'done' | 'error') => {
				const c = this.cells.find((c) => c.id === id);
				if (!c || c.type !== 'progress' || !alive()) return;
				if (text) c.text = text;
				c.state = state;
			},

			ask: (kind: AskKind, o: AskOpts) => {
				if (init) return Promise.reject(new Error('init.lua cannot ask questions'));
				if (!alive()) return never();
				const opts: AskOpts = { ...o, options: normOptions(o.options) };
				if (Array.isArray(o.fields))
					opts.fields = o.fields.map((f) => ({ ...f, options: normOptions(f.options) }));

				let r = this.takeReplay('ask', kind);
				if (!r && this.future[0]?.tag === kind) {
					r = this.future.shift()!;
					this.log.push(r);
				} else if (!r) this.future = [];
				if (r) {
					this.push({ type: 'ask', kind, opts, answered: true, answer: r.value, replayed: true });
					// logPos of a replayed ask must point *before* its entry
					const c = this.cells[this.cells.length - 1];
					c.logPos = this.log.length - 1;
					return Promise.resolve(r.value);
				}
				this.replaying = false;
				const logPos = this.log.length;
				const prev = this.prev[logPos];
				if (prev && prev.kind === 'ask' && prev.tag === kind) opts.default = prev.value;
				const cell = this.push({ type: 'ask', kind, opts, answered: false, replayed: false });
				this.status = 'waiting';
				return new Promise((resolve) => {
					this.pending.set(cell.id, (v) => {
						if (gen !== this.gen) return;
						this.log.push({ kind: 'ask', tag: kind, value: v });
						this.status = 'running';
						resolve(v);
					});
				});
			},

			http: (req: Parameters<typeof doHttp>[0]) => {
				if (init) return doHttp(req);
				return this.record(gen, 'http', `${req.method ?? ''} ${req.url}`, () => doHttp(req));
			},
			sleep: (ms: number) => {
				const live = () => new Promise<null>((r) => setTimeout(() => r(null), ms));
				if (init) return live();
				// replayed sleeps are skipped
				return this.record(gen, 'sleep', '', live);
			},
			seed: () => {
				if (init) return Date.now() % 2147483647;
				const r = this.takeReplay('seed', '');
				if (r) return r.value;
				const value = Math.floor(Math.random() * 2147483647);
				this.log.push({ kind: 'seed', tag: '', value });
				return value;
			},

			view: (op: string, name: string, o: { dock?: Dock; show?: boolean; size?: number }) => {
				if (alive()) views.apply(op, name, o);
			},
			view_list: () => Object.keys(views.all),

			resolve: (name: string, dir?: string) => scripts.resolve(name, dir ?? 'functions'),
			resolve_fn: (name: string) => {
				const p = `functions/${name}.lua`;
				return p in scripts.files ? p : null;
			},
			source: (path: string) => scripts.files[path] ?? '',

			json_encode: (v: unknown) => JSON.stringify(v ?? null),
			json_decode: (s: string) => JSON.parse(s),
			b64: (s: string) => toBase64(s),
			uri: (s: string) => encodeURIComponent(s),

			store_get: (k: string) => this.store.get(k),
			store_set: (k: string, v: unknown) => this.store.set(k, v)
		};
	}
}

export const runner = new Runner();
