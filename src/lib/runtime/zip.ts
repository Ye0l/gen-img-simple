// Minimal zip reader (stored + deflate entries, no zip64) for API responses
// that come back as archives, e.g. NovelAI's generate-image.

const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	json: 'application/json',
	txt: 'text/plain'
};

export function bytesToBase64(bytes: Uint8Array) {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(bin);
}

async function inflateRaw(data: Uint8Array) {
	const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(base64: string) {
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const dv = new DataView(bytes.buffer);
	let eocd = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
		if (dv.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('unzip: not a zip archive');

	const files: { name: string; mime: string; src: string }[] = [];
	let p = dv.getUint32(eocd + 16, true);
	for (let n = dv.getUint16(eocd + 10, true); n > 0; n--) {
		if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('unzip: corrupt central directory');
		const method = dv.getUint16(p + 10, true);
		const size = dv.getUint32(p + 20, true);
		const nameLen = dv.getUint16(p + 28, true);
		const local = dv.getUint32(p + 42, true);
		const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
		p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
		if (name.endsWith('/')) continue;

		const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
		let data = bytes.subarray(start, start + size);
		if (method === 8) data = await inflateRaw(data);
		else if (method !== 0) throw new Error(`unzip: unsupported compression ${method} (${name})`);
		const mime = MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
		files.push({ name, mime, src: `data:${mime};base64,${bytesToBase64(data)}` });
	}
	return files;
}
