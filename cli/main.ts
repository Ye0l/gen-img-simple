// CLI frontend: runs a flow in the terminal with the same engine as the web UI.
//
//   bun run cli                 pick a flow
//   bun run cli novelai         run flows/novelai.lua
//   bun run cli --resume <id>   replay a saved run and continue it
//   bun run cli --runs          list saved runs
//   --images=kitty|iterm|sixel|blocks|off   force how images show inline (default: detect)
//
// Every run is saved to DATA_DIR/runs/<id>.json; open it in the web UI with
// /?run=<id> to see the notebook, preview and log views.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import * as p from '@clack/prompts';
import { LuaFactory } from 'wasmoon';
import {
	FlowRun,
	newRunId,
	resolveScript,
	VIEW_IDS,
	type AskKind,
	type AskOpts,
	type Backend,
	type Entry,
	type Field,
	type Frontend,
	type ImageItem,
	type RunFile
} from '../src/lib/runtime/core.js';
import { proxyFetch } from '../src/lib/server/http.js';
import { createRuns } from '../src/lib/server/runs.js';
import { createScripts } from '../src/lib/server/scripts.js';
import { createStorage } from '../src/lib/server/storage.js';
import { detectImageMode, renderImage, type ImageMode } from './term-image.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const prelude = readFileSync(join(here, '../src/lib/runtime/prelude.lua'), 'utf8');

const DATA_DIR = process.env.DATA_DIR || 'data';
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || 'scripts';
const HTTP_ALLOW = (process.env.HTTP_ALLOW ?? '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const WEB = process.env.WEB_URL || 'http://localhost:5173';

const dim = (s: string) => styleText('dim', s);
const bold = (s: string) => styleText('bold', s);
const cyan = (s: string) => styleText('cyan', s);

/** replaced in main() once there is a run to save */
let onCancel = (): void => process.exit(130);

/** prompt result -> value; Ctrl+C saves the run and exits (a Lua pcall can't swallow it) */
function ok<T>(v: T): Exclude<T, symbol> {
	if (p.isCancel(v)) {
		onCancel();
		throw new Error('cancelled');
	}
	return v as Exclude<T, symbol>;
}

/** markdown -> terminal text (headings, bold, inline code; the rest stays as written) */
function renderMd(text: string) {
	return text
		.trim()
		.split('\n')
		.map((line) => {
			const h = line.match(/^#{1,6}\s+(.*)$/);
			if (h) return bold(h[1]);
			return line
				.replace(/\*\*(.+?)\*\*/g, (_, s) => bold(s))
				.replace(/`([^`]+)`/g, (_, s) => cyan(s))
				.replace(/(^|[^*])\*([^*]+)\*/g, (_, a, s) => a + styleText('italic', s));
		})
		.join('\n');
}

function summary(kind: AskKind, opts: AskOpts, v: unknown) {
	const label = (x: unknown) =>
		opts.options?.find((o) => JSON.stringify(o.value) === JSON.stringify(x))?.label ?? String(x);
	switch (kind) {
		case 'secret':
			return `•••••• (${opts.name} saved)`;
		case 'confirm':
			return v ? 'Yes' : 'No';
		case 'choose':
			return label(v);
		case 'multi':
			return (v as unknown[]).map(label).join(', ') || '(none)';
		case 'form':
			return Object.entries(v as Record<string, unknown>)
				.map(([k, x]) => `${k}: ${x}`)
				.join(' · ');
		default:
			return String(v ?? '');
	}
}

const numberCheck = (min?: number, max?: number) => (s: string | undefined) => {
	const n = Number(s);
	if (s === undefined || s.trim() === '' || Number.isNaN(n)) return 'enter a number';
	if (min != null && n < min) return `min ${min}`;
	if (max != null && n > max) return `max ${max}`;
};

async function askField(title: string, f: Field, initial: unknown): Promise<unknown> {
	const message = `${title} › ${f.label ?? f.name}`;
	const def = initial ?? f.default;
	switch (f.type) {
		case 'number':
			return Number(
				ok(await p.text({ message, initialValue: def == null ? '' : String(def), validate: numberCheck(f.min, f.max) }))
			);
		case 'checkbox':
			return ok(await p.confirm({ message, initialValue: def == null ? false : !!def }));
		case 'select': {
			const options = f.options ?? [];
			const i = ok(
				await p.select({
					message,
					options: options.map((o, i) => ({ value: i, label: o.label, hint: o.hint })),
					initialValue: Math.max(0, options.findIndex((o) => JSON.stringify(o.value) === JSON.stringify(def)))
				})
			);
			return options[i]?.value;
		}
		case 'textarea':
			return ok(await p.multiline({ message, initialValue: def == null ? '' : String(def) })).replace(/\n+$/, '');
		default:
			return ok(await p.text({ message, initialValue: def == null ? '' : String(def), placeholder: f.placeholder }));
	}
}

async function ask(kind: AskKind, o: AskOpts): Promise<unknown> {
	const message = o.hint ? `${o.label ?? kind} ${dim(o.hint)}` : (o.label ?? kind);
	const def = o.default;
	const options = o.options ?? [];
	const indexOf = (v: unknown) => options.findIndex((x) => JSON.stringify(x.value) === JSON.stringify(v));
	switch (kind) {
		case 'secret':
			return ok(await p.password({ message, validate: (s) => (s?.trim() ? undefined : 'required') })).trim();
		case 'input': {
			const validate = o.required ? (s: string | undefined) => (s?.trim() ? undefined : 'required') : undefined;
			const initialValue = def == null ? '' : String(def);
			// multiline submits on a double Enter; drop the trailing newline that leaves
			return o.multiline
				? ok(await p.multiline({ message: `${message} ${dim('(Enter 두 번 = 제출)')}`, initialValue, validate })).replace(/\n+$/, '')
				: ok(await p.text({ message, initialValue, placeholder: o.placeholder, validate }));
		}
		case 'number':
			return Number(
				ok(await p.text({ message, initialValue: def == null ? '' : String(def), validate: numberCheck(o.min, o.max) }))
			);
		case 'confirm':
			return ok(await p.confirm({ message, initialValue: def == null ? true : !!def }));
		case 'choose': {
			const i = ok(
				await p.select({
					message,
					options: options.map((x, i) => ({ value: i, label: x.label, hint: x.hint })),
					initialValue: Math.max(0, indexOf(def))
				})
			);
			return options[i].value;
		}
		case 'multi': {
			const picked = ok(
				await p.multiselect({
					message,
					options: options.map((x, i) => ({ value: i, label: x.label, hint: x.hint })),
					initialValues: Array.isArray(def) ? def.map(indexOf).filter((i) => i >= 0) : [],
					required: false
				})
			);
			return picked.map((i) => options[i].value);
		}
		case 'form': {
			const out: Record<string, unknown> = {};
			for (const f of o.fields ?? []) {
				out[f.name] = await askField(o.label ?? 'form', f, (def as Record<string, unknown> | undefined)?.[f.name]);
			}
			return out;
		}
	}
}

/**
 * data: urls are written under DATA_DIR/out/<run>/ (sync, so the image lands
 * before the next prompt) and shown inline when the terminal can.
 */
function showImage(dir: string, n: number, img: ImageItem, mode: ImageMode) {
	const title = `image ${n}${img.caption ? ` (${img.caption})` : ''}`;
	const m = img.src.match(/^data:([\w/+.-]+)(;base64)?,(.*)$/s);
	if (!m) return p.log.success(`${title}: ${cyan(img.src)}`);
	const mime = m[1];
	const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[mime] ?? 'bin';
	const data = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
	const file = join(dir, `${String(n).padStart(3, '0')}.${ext}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(file, data);
	p.log.success(`${title}: ${cyan(relative(process.cwd(), file))}`);
	const inline = renderImage(mode, mime, data);
	if (inline) process.stdout.write(inline);
	else if (mode !== 'off') p.log.message(dim(`(${mime} can't be shown in this terminal mode, see the file)`));
}

async function main() {
	const args = process.argv.slice(2);
	const scripts = createScripts(SCRIPTS_DIR);
	const { secrets, texts } = createStorage(DATA_DIR);
	const runs = createRuns(DATA_DIR);
	// before any prompt: sixel detection talks to the terminal over stdin
	const imageMode = await detectImageMode(args.find((a) => a.startsWith('--images='))?.slice(9));

	if (args.includes('--runs')) {
		for (const r of await runs.list())
			console.log(`${r.id}  ${dim(`${r.flow} · ${r.origin} · ${r.status} · ${new Date(r.updated).toLocaleString()}`)}`);
		return;
	}

	const files = await scripts.readAll();
	// storage is mirrored in memory so the engine's sync reads work; writes go to disk too
	let secretNames = await secrets.names();
	const textCache = await texts.all();

	const backend: Backend = {
		files: () => files,
		http: async (req) => proxyFetch(req, await secrets.all(), HTTP_ALLOW),
		secretNames: () => secretNames,
		setSecret: async (n, v) => {
			await secrets.set(n, v);
			secretNames = await secrets.names();
		},
		deleteSecret: async (n) => {
			await secrets.delete(n);
			secretNames = await secrets.names();
		},
		texts: () => textCache,
		setText: async (n, v) => {
			await texts.set(n, v);
			textCache[n] = v;
		},
		deleteText: async (n) => {
			await texts.delete(n);
			delete textCache[n];
		}
	};

	// which flow / which run
	let run: RunFile;
	const resumeAt = args.indexOf('--resume');
	if (resumeAt >= 0) {
		const id = args[resumeAt + 1];
		if (!id) throw new Error('usage: --resume <run id> (see --runs)');
		run = await runs.get(id);
	} else {
		let flow = args.find((a) => !a.startsWith('-'));
		const flows = Object.keys(files)
			.filter((f) => f.startsWith('flows/'))
			.sort();
		if (!flow) {
			p.intro(bold('gen-img'));
			flow = ok(
				await p.select({
					message: 'flow',
					options: flows.map((f) => ({
						value: f,
						label: f.replace(/^flows\//, '').replace(/\.lua$/, ''),
						hint: files[f].match(/^--\s*(.*)$/m)?.[1]
					}))
				})
			);
		}
		const path = resolveScript(files, flow, 'flows');
		if (!path) throw new Error(`flow not found: ${flow} (available: ${flows.join(', ')})`);
		run = { id: newRunId(path), flow: path, created: Date.now(), updated: Date.now(), origin: 'cli', status: 'running', log: [] };
	}

	const path = resolveScript(files, run.flow, 'flows');
	if (!path) throw new Error(`flow not found: ${run.flow}`);
	const outDir = resolve(DATA_DIR, 'out', run.id);
	let imageCount = 0;

	let log: Entry[] = run.log;
	let saving = Promise.resolve();
	const save = (status: string) => {
		const snapshot: RunFile = { ...run, origin: 'cli', status, updated: Date.now(), log: [...log] };
		saving = saving.then(() => runs.save(snapshot)).catch((e) => p.log.error(`saving run failed: ${e}`));
		return saving;
	};

	const spinners = new Map<number, ReturnType<typeof p.spinner>>();
	let spinnerId = 0;

	const frontend: Frontend = {
		md: (text, style) => p.log.message(style === 'note' ? dim(renderMd(text)) : renderMd(text)),
		print: (level, text) =>
			level === 'error' ? p.log.error(text) : level === 'warn' ? p.log.warn(text) : p.log.info(dim(text)),
		image: (images) => {
			for (const img of images) {
				try {
					showImage(outDir, ++imageCount, img, imageMode);
				} catch (e) {
					p.log.error(`saving image failed: ${e}`);
				}
			}
		},
		progress: (text) => {
			const s = p.spinner();
			s.start(text);
			spinners.set(++spinnerId, s);
			return spinnerId;
		},
		progressUpdate: (id, text, state) => {
			const s = spinners.get(id);
			if (!s) return;
			if (state === 'running') return s.message(text);
			spinners.delete(id);
			if (state === 'done') s.stop(text);
			else s.error(text);
		},
		replayed: (kind, opts, value) => p.log.step(`${opts.label ?? kind}\n${dim(summary(kind, opts, value))}`),
		ask: (kind, opts) => ask(kind, opts),
		// views are a web UI thing; the saved run shows them when opened there
		view: () => {},
		viewList: () => VIEW_IDS
	};

	const flowRun = new FlowRun({
		factory: new LuaFactory(),
		prelude,
		frontend,
		backend,
		replay: run.log,
		onEntry: (l) => {
			log = l;
			save('running');
		}
	});

	const stop = async (status: string) => {
		log = flowRun.log.length ? flowRun.log : log;
		await save(status);
	};
	const cancel = async () => {
		flowRun.kill();
		await stop('stopped');
		p.cancel(`stopped · resume: bun run cli --resume ${run.id}`);
		process.exit(130);
	};
	onCancel = () => void cancel();
	process.on('SIGINT', cancel);

	if (resumeAt >= 0) p.intro(`${bold('gen-img')} ${dim(`resume ${run.id}`)}`);
	else if (args.some((a) => !a.startsWith('-'))) p.intro(`${bold('gen-img')} ${dim(path)}`);

	try {
		await flowRun.run(path);
		await stop('done');
		p.outro(`done · run ${cyan(run.id)} ${dim(`(web: ${WEB}/?run=${run.id})`)}`);
	} catch (e) {
		if (flowRun.dead) return; // cancelled: cancel() exits
		await stop('error');
		p.log.error(e instanceof Error ? e.message : String(e));
		p.outro(`failed · run ${cyan(run.id)} ${dim(`(web: ${WEB}/?run=${run.id})`)}`);
		process.exit(1);
	}
}

main().catch((e) => {
	p.log.error(e instanceof Error ? e.message : String(e));
	process.exit(1);
});
