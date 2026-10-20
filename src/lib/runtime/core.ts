// Environment-agnostic flow engine shared by the web UI and the CLI.
//
// Editing works by deterministic replay: every non-deterministic host call
// (user answers, http responses, the random seed, sleeps, storage reads) is
// recorded in an ordered log. Re-running a flow with that log feeds the values
// back, so earlier answers can be changed without repeating generations, and a
// saved log is a complete transcript any frontend can render again.
//
// The engine talks to two sides:
// - Frontend: how output is shown and questions are asked (notebook cells, terminal prompts)
// - Backend: where scripts, storage and http live (server api from the browser, fs in the CLI)

import type { LuaEngine, LuaFactory } from 'wasmoon';
import { unzip } from './zip.js';

export type AskKind = 'input' | 'choose' | 'multi' | 'confirm' | 'number' | 'form' | 'secret';

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
	/** secret asks: storage name the value is saved under */
	name?: string;
}

export interface Entry {
	kind: 'seed' | 'ask' | 'http' | 'sleep' | 'store';
	tag: string;
	value: unknown;
}

export type Dock = 'left' | 'right' | 'top' | 'bottom' | 'split';
export type ProgressState = 'running' | 'done' | 'error';
export interface ImageItem {
	src: string;
	caption?: string;
}

/** a saved run: enough to render it again anywhere, or to continue it */
export interface RunFile {
	id: string;
	flow: string;
	created: number;
	updated: number;
	/** where it was last driven from */
	origin: 'web' | 'cli';
	status: string;
	log: Entry[];
}

export interface HttpRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
	/** browser only: skip the server proxy */
	direct?: boolean;
}

export interface HttpRaw {
	status: number;
	ok: boolean;
	headers: Record<string, string>;
	body: string;
	encoding: 'text' | 'base64' | string;
}

export interface Frontend {
	md(text: string, style: 'md' | 'note'): void;
	print(level: string, text: string): void;
	image(images: ImageItem[]): void;
	progress(text: string): number;
	progressUpdate(id: number, text: string | undefined, state: ProgressState): void;
	/** a question answered from the log; `logPos` is the log index of its entry */
	replayed(kind: AskKind, opts: AskOpts, value: unknown, logPos: number): void;
	/** a live question; resolves with the raw answer (secret values included) */
	ask(kind: AskKind, opts: AskOpts, logPos: number): Promise<unknown>;
	view(op: string, name: string, o: { dock?: Dock; show?: boolean; size?: number }): void;
	viewList(): string[];
}

export interface Backend {
	/** script path -> source */
	files(): Record<string, string>;
	http(req: HttpRequest): Promise<HttpRaw>;
	secretNames(): string[];
	setSecret(name: string, value: string): Promise<void>;
	deleteSecret(name: string): Promise<void>;
	texts(): Record<string, string>;
	setText(name: string, value: string): Promise<void>;
	deleteText(name: string): Promise<void>;
}

/** "flows/novelai.lua" -> "novelai-20261020-153012" */
export function newRunId(flow: string) {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	const name = flow.replace(/^flows\//, '').replace(/\.lua$/, '').replace(/[^\w.-]/g, '_');
	return `${name}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export const VIEW_IDS = ['preview', 'log', 'editor', 'storage'];

const never = () => new Promise<never>(() => {});
export const plain = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * Lua tables cross over as objects/arrays, but an empty table always becomes {}.
 * json.array(t) in Lua marks a table with __array so it is sent as a JSON array.
 */
export function fixArrays(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(fixArrays);
	if (v === null || typeof v !== 'object') return v;
	const o = v as Record<string, unknown>;
	if (o.__array) {
		return Object.keys(o)
			.filter((k) => k !== '__array')
			.sort((a, b) => Number(a) - Number(b))
			.map((k) => fixArrays(o[k]));
	}
	return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fixArrays(x)]));
}

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

/**
 * "foo" -> functions/foo.lua, "flows/x" -> flows/x.lua, exact paths as-is.
 * `dir` is the default folder for bare names.
 */
export function resolveScript(files: Record<string, string>, name: string, dir = 'functions'): string | null {
	const n = name.replace(/\./g, '/').replace(/\/lua$/, '');
	const candidates = [name, `${n}.lua`, `${dir}/${n}.lua`, `${n}/init.lua`, `${dir}/${n}/init.lua`];
	return candidates.find((c) => c in files) ?? null;
}

/** raw transport result -> what Lua sees: { status, ok, headers, body, json?, data_url? } */
function toLuaResponse(out: HttpRaw) {
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

export interface RunOptions {
	factory: LuaFactory;
	prelude: string;
	frontend: Frontend;
	backend: Backend;
	/** log to feed back before running live */
	replay?: Entry[];
	/** answers re-applied automatically once the replay runs out ("run to end") */
	future?: Entry[];
	/** log of the previous run: its answers become defaults */
	prev?: Entry[];
	/** init.lua mode: nothing is recorded and questions are refused */
	init?: boolean;
	/** session key/value store shared across runs (Lua `store`) */
	store?: Map<string, unknown>;
	/** called whenever an entry is appended to the log */
	onEntry?: (log: Entry[]) => void;
	/** called when replay runs out and the run goes live */
	onLive?: () => void;
}

// no proxies: JS values reach Lua as plain tables (pairs/type work as expected)
const engineOpts = { enableProxy: false };

export class FlowRun {
	log: Entry[] = [];
	dead = false;
	private engine: LuaEngine | null = null;
	private replay: Entry[];
	private future: Entry[];
	private live = false;

	constructor(private o: RunOptions) {
		this.replay = o.replay ?? [];
		this.future = o.future ?? [];
		if (!this.replay.length) this.live = true;
	}

	get replaying() {
		return !this.live;
	}

	/** run a script path to completion (throws Lua errors) */
	async run(path: string) {
		const engine = await this.o.factory.createEngine(engineOpts);
		if (this.dead) return engine.global.close();
		this.engine = engine;
		try {
			engine.global.set('__host', this.host());
			// load() instead of doString so tracebacks say "prelude" instead of the whole source
			engine.global.set('__prelude', this.o.prelude);
			await engine.doString('local src = __prelude; __prelude = nil; assert(load(src, "@prelude"))()');
			await engine.doString(`__main(${JSON.stringify(path)})`);
		} finally {
			this.goLive();
			this.close();
		}
	}

	/** abandon the run: pending questions never resolve, no more output */
	kill() {
		this.dead = true;
		this.close();
	}

	private close() {
		try {
			this.engine?.global.close();
		} catch {
			/* already closed */
		}
		this.engine = null;
	}

	private goLive() {
		if (this.live) return;
		this.live = true;
		this.o.onLive?.();
	}

	private push(e: Entry) {
		this.log.push(e);
		if (!this.o.init) this.o.onEntry?.(this.log);
	}

	private takeReplay(kind: Entry['kind'], tag: string): Entry | null {
		const i = this.log.length;
		const r = this.replay[i];
		if (r && r.kind === kind && r.tag === tag) {
			this.push(r);
			return r;
		}
		// script changed shape: stop replaying from here on
		if (r) this.replay = this.replay.slice(0, i);
		return null;
	}

	/** replay-aware wrapper for anything non-deterministic */
	private async record<T>(kind: Entry['kind'], tag: string, live: () => Promise<T>): Promise<T> {
		if (this.o.init) return live();
		const r = this.takeReplay(kind, tag);
		if (r) return r.value as T;
		this.goLive();
		const value = await live();
		if (this.dead) return never();
		this.push({ kind, tag, value: plain(value) });
		return value;
	}

	/** sync variant of record() for reads like the seed or storage lookups */
	private recordSync<T>(kind: Entry['kind'], tag: string, live: () => T): T {
		if (this.o.init) return live();
		const r = this.takeReplay(kind, tag);
		if (r) return r.value as T;
		const value = plain(live());
		this.push({ kind, tag, value });
		return value;
	}

	private ask(kind: AskKind, o: AskOpts): Promise<unknown> {
		if (this.o.init) return Promise.reject(new Error('init.lua cannot ask questions'));
		if (this.dead) return never();
		const { frontend, backend } = this.o;
		const opts: AskOpts = { ...o, options: normOptions(o.options) };
		if (Array.isArray(o.fields)) opts.fields = o.fields.map((f) => ({ ...f, options: normOptions(f.options) }));

		let r = this.takeReplay('ask', kind);
		if (!r && this.future[0]?.tag === kind) {
			r = this.future.shift()!;
			this.push(r);
		} else if (!r) this.future = [];
		if (r) {
			frontend.replayed(kind, opts, r.value, this.log.length - 1);
			return Promise.resolve(r.value);
		}

		this.goLive();
		const logPos = this.log.length;
		const prev = this.o.prev?.[logPos];
		if (prev && prev.kind === 'ask' && prev.tag === kind) opts.default = prev.value;
		return frontend.ask(kind, opts, logPos).then(async (v) => {
			if (this.dead) return never();
			// secret values go straight to storage; only `true` is recorded
			if (kind === 'secret') {
				await backend.setSecret(opts.name!, String(v));
				v = true;
			}
			v = plain(v);
			this.push({ kind: 'ask', tag: kind, value: v });
			return v;
		});
	}

	private async http(req: {
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
			body = JSON.stringify(fixArrays(req.json));
			headers['content-type'] ??= 'application/json';
		}
		const method = req.method ?? (body ? 'POST' : 'GET');
		return toLuaResponse(await this.o.backend.http({ url: req.url, method, headers, body, direct: req.direct }));
	}

	private host() {
		const { frontend: ui, backend } = this.o;
		const init = !!this.o.init;
		const alive = () => !this.dead;
		const store = this.o.store ?? new Map<string, unknown>();

		return {
			md: (text: string) => alive() && !init && ui.md(text, 'md'),
			note: (text: string) => alive() && !init && ui.md(text, 'note'),
			print: (level: string, text: string) => alive() && ui.print(level, text),
			image: (list: ImageItem[]) => {
				if (!alive() || init) return;
				ui.image((Array.isArray(list) ? list : []).filter((i) => i && i.src));
			},
			progress: (text: string) => (alive() && !init ? ui.progress(text) : 0),
			progress_update: (id: number, text: string | undefined, state: ProgressState) =>
				alive() && !init && ui.progressUpdate(id, text, state),

			ask: (kind: AskKind, o: AskOpts) => this.ask(kind, o),

			http: (req: Parameters<FlowRun['http']>[0]) =>
				this.record('http', `${req.method ?? ''} ${req.url}`, () => this.http(req)),
			// replayed sleeps are skipped
			sleep: (ms: number) => this.record('sleep', '', () => new Promise<void>((r) => setTimeout(r, ms))),
			seed: () => this.recordSync('seed', '', () => Math.floor(Math.random() * 2147483647)),

			// persistent storage: reads are recorded, writes are skipped while replaying
			secret_has: (name: string) => this.recordSync('store', `secret?${name}`, () => backend.secretNames().includes(name)),
			secret_list: () => this.recordSync('store', 'secrets', () => [...backend.secretNames()]),
			secret_delete: (name: string) =>
				this.record('store', `secret-delete:${name}`, () => backend.deleteSecret(name)),
			text_get: (name: string) => this.recordSync('store', `text:${name}`, () => backend.texts()[name]),
			text_list: (prefix: string) =>
				this.recordSync('store', `texts:${prefix}`, () =>
					Object.keys(backend.texts())
						.filter((k) => k.startsWith(prefix))
						.sort()
				),
			text_set: (name: string, value: string) =>
				this.record('store', `text-set:${name}`, () => backend.setText(name, String(value))),
			text_delete: (name: string) => this.record('store', `text-delete:${name}`, () => backend.deleteText(name)),
			unzip: (base64: string) => unzip(base64),

			view: (op: string, name: string, o: { dock?: Dock; show?: boolean; size?: number }) =>
				alive() && ui.view(op, name, o),
			view_list: () => ui.viewList(),

			resolve: (name: string, dir?: string) => resolveScript(backend.files(), name, dir ?? 'functions') ?? undefined,
			resolve_fn: (name: string) => {
				const p = `functions/${name}.lua`;
				return p in backend.files() ? p : undefined;
			},
			source: (path: string) => backend.files()[path] ?? '',

			json_encode: (v: unknown) => JSON.stringify(fixArrays(v ?? null)),
			// wasmoon chokes on a bare null return value (it probes .then)
			json_decode: (s: string) => JSON.parse(s) ?? undefined,
			b64: (s: string) => toBase64(s),
			uri: (s: string) => encodeURIComponent(s),

			store_get: (k: string) => store.get(k),
			store_set: (k: string, v: unknown) => void store.set(k, v)
		};
	}
}
