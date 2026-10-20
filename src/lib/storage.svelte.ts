// Client mirror of the server storage. Secrets: names only (values are
// write-only and never sent back). Text: full name -> value map.

const send = async (url: string, method: 'PUT' | 'DELETE', value?: string) => {
	const res = await fetch(url, {
		method,
		headers: { 'content-type': 'application/json' },
		body: value === undefined ? undefined : JSON.stringify({ value })
	});
	if (!res.ok) throw new Error(`${method} ${url} failed: ${await res.text()}`);
};

const enc = (name: string) => name.split('/').map(encodeURIComponent).join('/');

class Storage {
	secrets = $state<string[]>([]);
	text = $state<Record<string, string>>({});

	async load() {
		const res = await fetch('/api/store');
		if (!res.ok) throw new Error(`failed to load storage: ${res.status}`);
		const data = (await res.json()) as { secrets: string[]; text: Record<string, string> };
		this.secrets = data.secrets;
		this.text = data.text;
	}

	async setSecret(name: string, value: string) {
		await send(`/api/store/secret/${enc(name)}`, 'PUT', value);
		if (!this.secrets.includes(name)) this.secrets = [...this.secrets, name].sort();
	}

	async deleteSecret(name: string) {
		await send(`/api/store/secret/${enc(name)}`, 'DELETE');
		this.secrets = this.secrets.filter((s) => s !== name);
	}

	async setText(name: string, value: string) {
		await send(`/api/store/text/${enc(name)}`, 'PUT', value);
		this.text[name] = value;
	}

	async deleteText(name: string) {
		await send(`/api/store/text/${enc(name)}`, 'DELETE');
		delete this.text[name];
	}
}

export const storage = new Storage();
