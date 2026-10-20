// Client-side copy of every script under scripts/. The editor works on this
// copy, and the runtime reads from it, so unsaved edits run immediately.

import { resolveScript } from './runtime/core.js';

class Scripts {
	files = $state<Record<string, string>>({});
	saved = $state<Record<string, string>>({});
	loaded = $state(false);

	get paths() {
		return Object.keys(this.files).sort();
	}
	get flows() {
		return this.paths.filter((p) => p.startsWith('flows/'));
	}
	isDirty(path: string) {
		return this.files[path] !== this.saved[path];
	}

	async load() {
		const res = await fetch('/api/scripts');
		if (!res.ok) throw new Error(`failed to load scripts: ${res.status}`);
		const { files } = (await res.json()) as { files: Record<string, string> };
		this.files = { ...files };
		this.saved = { ...files };
		this.loaded = true;
	}

	async save(path: string) {
		// JSON (not text/plain) so the request is never treated as a cross-site form post
		const res = await fetch(`/api/scripts/${path}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ content: this.files[path] })
		});
		if (!res.ok) throw new Error(`save failed: ${await res.text()}`);
		this.saved[path] = this.files[path];
	}

	async remove(path: string) {
		const res = await fetch(`/api/scripts/${path}`, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' }
		});
		if (!res.ok) throw new Error(`delete failed: ${await res.text()}`);
		delete this.files[path];
		delete this.saved[path];
	}

	create(path: string, content = '') {
		if (!path.endsWith('.lua')) path += '.lua';
		if (!(path in this.files)) this.files[path] = content;
		return path;
	}

	resolve(name: string, dir = 'functions') {
		return resolveScript(this.files, name, dir);
	}
}

export const scripts = new Scripts();
