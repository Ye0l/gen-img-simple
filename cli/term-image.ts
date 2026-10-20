// Inline images in the terminal, with fallbacks:
//   kitty  - kitty graphics protocol (kitty, ghostty)          PNG
//   iterm  - iTerm2 inline images (iTerm2, WezTerm)            PNG/JPEG/GIF
//   sixel  - DEC sixel (detected via the DA1 reply; e.g. newer Termux, foot, mlterm, xterm -ti vt340)
//   blocks - truecolor half-block characters, works almost anywhere
//   off    - nothing (the file path is always printed by the caller)
// sixel/blocks need pixels, so they handle PNG only (decoded here with zlib).
// Override with GENIMG_IMAGES=<mode> or --images=<mode>.

import { inflateSync } from 'node:zlib';

export type ImageMode = 'kitty' | 'iterm' | 'sixel' | 'blocks' | 'off';
export const IMAGE_MODES: ImageMode[] = ['kitty', 'iterm', 'sixel', 'blocks', 'off'];

/** ask the terminal for its primary device attributes; "4" in the reply means sixel */
function querySixel(timeout = 250): Promise<boolean> {
	const { stdin, stdout } = process;
	if (!stdin.isTTY || !stdout.isTTY) return Promise.resolve(false);
	return new Promise((resolve) => {
		let buf = '';
		const wasRaw = stdin.isRaw;
		const done = (v: boolean) => {
			clearTimeout(timer);
			stdin.off('data', onData);
			stdin.setRawMode(wasRaw);
			stdin.pause();
			resolve(v);
		};
		const onData = (d: Buffer) => {
			buf += d.toString('latin1');
			const m = buf.match(/\x1b\[\?([\d;]*)c/);
			if (m) done(m[1].split(';').includes('4'));
		};
		const timer = setTimeout(() => done(false), timeout);
		stdin.setRawMode(true);
		stdin.on('data', onData);
		stdin.resume();
		stdout.write('\x1b[c');
	});
}

export async function detectImageMode(forced?: string): Promise<ImageMode> {
	const want = (forced || process.env.GENIMG_IMAGES || 'auto').toLowerCase();
	if (IMAGE_MODES.includes(want as ImageMode)) return want as ImageMode;
	if (!process.stdout.isTTY) return 'off';
	const env = process.env;
	// multiplexers swallow graphics escapes unless configured; stay with text there
	if (env.TMUX || env.STY) return 'blocks';
	if (env.TERM === 'xterm-kitty' || env.KITTY_WINDOW_ID || env.TERM_PROGRAM === 'ghostty') return 'kitty';
	if (env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'WezTerm' || env.LC_TERMINAL === 'iTerm2')
		return 'iterm';
	if (await querySixel()) return 'sixel';
	return 'blocks';
}

// ---------------------------------------------------------------- PNG decoding

interface Pixels {
	width: number;
	height: number;
	/** RGB, 3 bytes per pixel, alpha composited over black */
	rgb: Uint8Array;
}

export function decodePng(buf: Buffer): Pixels | null {
	if (buf.readUInt32BE(0) !== 0x89504e47) return null;
	let pos = 8;
	let width = 0,
		height = 0,
		depth = 0,
		type = 0,
		interlace = 0;
	let palette: Buffer | null = null;
	let trns: Buffer | null = null;
	const idat: Buffer[] = [];
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const name = buf.toString('latin1', pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		if (name === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			depth = data[8];
			type = data[9];
			interlace = data[12];
		} else if (name === 'PLTE') palette = data;
		else if (name === 'tRNS') trns = data;
		else if (name === 'IDAT') idat.push(data);
		else if (name === 'IEND') break;
		pos += 12 + len;
	}
	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
	if (depth !== 8 || interlace || !channels || (type === 3 && !palette)) return null;

	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const cur = new Uint8Array(stride);
	const prev = new Uint8Array(stride);
	const rgb = new Uint8Array(width * height * 3);
	for (let y = 0; y < height; y++) {
		const row = y * (stride + 1);
		const filter = raw[row];
		for (let x = 0; x < stride; x++) {
			const v = raw[row + 1 + x];
			const a = x >= channels ? cur[x - channels] : 0;
			const b = prev[x];
			const c = x >= channels ? prev[x - channels] : 0;
			let p: number;
			if (filter === 0) p = v;
			else if (filter === 1) p = v + a;
			else if (filter === 2) p = v + b;
			else if (filter === 3) p = v + ((a + b) >> 1);
			else {
				const pa = Math.abs(b - c),
					pb = Math.abs(a - c),
					pc = Math.abs(a + b - 2 * c);
				p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
			}
			cur[x] = p & 0xff;
		}
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 3;
			const i = x * channels;
			let r: number, g: number, bl: number, al = 255;
			if (type === 3) {
				const idx = cur[i];
				r = palette![idx * 3];
				g = palette![idx * 3 + 1];
				bl = palette![idx * 3 + 2];
				if (trns && idx < trns.length) al = trns[idx];
			} else if (type === 0 || type === 4) {
				r = g = bl = cur[i];
				if (type === 4) al = cur[i + 1];
			} else {
				r = cur[i];
				g = cur[i + 1];
				bl = cur[i + 2];
				if (type === 6) al = cur[i + 3];
			}
			rgb[o] = (r * al) / 255;
			rgb[o + 1] = (g * al) / 255;
			rgb[o + 2] = (bl * al) / 255;
		}
		prev.set(cur);
	}
	return { width, height, rgb };
}

/** box-filter downscale (never upscales) */
function resize(src: Pixels, w: number, h: number): Pixels {
	w = Math.max(1, Math.min(w, src.width));
	h = Math.max(1, Math.min(h, src.height));
	const rgb = new Uint8Array(w * h * 3);
	const sx = src.width / w,
		sy = src.height / h;
	for (let y = 0; y < h; y++) {
		const y0 = Math.floor(y * sy),
			y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
		for (let x = 0; x < w; x++) {
			const x0 = Math.floor(x * sx),
				x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
			let r = 0,
				g = 0,
				b = 0,
				n = 0;
			// sample at most ~8x8 source pixels per target pixel
			const stepY = Math.max(1, Math.floor((y1 - y0) / 8)),
				stepX = Math.max(1, Math.floor((x1 - x0) / 8));
			for (let yy = y0; yy < y1; yy += stepY)
				for (let xx = x0; xx < x1; xx += stepX) {
					const i = (yy * src.width + xx) * 3;
					r += src.rgb[i];
					g += src.rgb[i + 1];
					b += src.rgb[i + 2];
					n++;
				}
			const o = (y * w + x) * 3;
			rgb[o] = r / n;
			rgb[o + 1] = g / n;
			rgb[o + 2] = b / n;
		}
	}
	return { width: w, height: h, rgb };
}

// ---------------------------------------------------------------- encoders

function kitty(png: Buffer, cols: number) {
	const b64 = png.toString('base64');
	let out = '';
	for (let i = 0; i < b64.length; i += 4096) {
		const more = i + 4096 < b64.length ? 1 : 0;
		const head = i === 0 ? `f=100,a=T,c=${cols},m=${more}` : `m=${more}`;
		out += `\x1b_G${head};${b64.slice(i, i + 4096)}\x1b\\`;
	}
	return out + '\n';
}

function iterm(data: Buffer, cols: number) {
	return `\x1b]1337;File=inline=1;width=${cols};preserveAspectRatio=1;size=${data.length}:${data.toString('base64')}\x07\n`;
}

/** two pixels per cell: foreground = top, background = bottom */
function blocks(px: Pixels) {
	const lines: string[] = [];
	for (let y = 0; y < px.height; y += 2) {
		let line = '';
		for (let x = 0; x < px.width; x++) {
			const t = (y * px.width + x) * 3;
			const b = y + 1 < px.height ? ((y + 1) * px.width + x) * 3 : t;
			line += `\x1b[38;2;${px.rgb[t]};${px.rgb[t + 1]};${px.rgb[t + 2]}m\x1b[48;2;${px.rgb[b]};${px.rgb[b + 1]};${px.rgb[b + 2]}m▀`;
		}
		lines.push(line + '\x1b[0m');
	}
	return lines.join('\n') + '\n';
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** 6x6x6 color cube palette (ordered dithering hides the banding), run-length encoded bands */
function sixel(px: Pixels) {
	const idx = new Uint8Array(px.width * px.height);
	for (let y = 0; y < px.height; y++)
		for (let x = 0; x < px.width; x++) {
			const i = y * px.width + x;
			const d = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
			const lv = (v: number) => Math.max(0, Math.min(5, Math.round((v / 255) * 5 + d)));
			idx[i] = lv(px.rgb[i * 3]) * 36 + lv(px.rgb[i * 3 + 1]) * 6 + lv(px.rgb[i * 3 + 2]);
		}

	let out = `\x1bPq"1;1;${px.width};${px.height}`;
	for (let c = 0; c < 216; c++) {
		const pct = (n: number) => Math.round((n / 5) * 100);
		out += `#${c};2;${pct(Math.floor(c / 36))};${pct(Math.floor(c / 6) % 6)};${pct(c % 6)}`;
	}
	for (let y0 = 0; y0 < px.height; y0 += 6) {
		const used = new Set<number>();
		for (let y = y0; y < Math.min(y0 + 6, px.height); y++)
			for (let x = 0; x < px.width; x++) used.add(idx[y * px.width + x]);
		let first = true;
		for (const c of used) {
			if (!first) out += '$';
			first = false;
			out += `#${c}`;
			let run = 0,
				last = -1;
			const flush = () => {
				if (run === 0) return;
				const ch = String.fromCharCode(63 + last);
				out += run > 3 ? `!${run}${ch}` : ch.repeat(run);
			};
			for (let x = 0; x < px.width; x++) {
				let bits = 0;
				for (let k = 0; k < 6; k++) {
					const y = y0 + k;
					if (y < px.height && idx[y * px.width + x] === c) bits |= 1 << k;
				}
				if (bits === last) run++;
				else {
					flush();
					last = bits;
					run = 1;
				}
			}
			flush();
		}
		out += '-';
	}
	return out + '\x1b\\\n';
}

/**
 * Terminal escape sequence that shows the image, or null when this mode can't
 * show this format (the caller then just prints the path).
 */
export function renderImage(mode: ImageMode, mime: string, data: Buffer): string | null {
	if (mode === 'off') return null;
	const termCols = process.stdout.columns || 80;
	const cols = Math.max(16, Math.min(termCols - 4, 48));
	const isPng = mime === 'image/png';
	if (mode === 'kitty') return isPng ? kitty(data, cols) : null;
	if (mode === 'iterm') return /^image\/(png|jpeg|gif)$/.test(mime) ? iterm(data, cols) : null;
	if (!isPng) return null;
	let px: Pixels | null;
	try {
		px = decodePng(data);
	} catch {
		px = null;
	}
	if (!px) return null;
	if (mode === 'sixel') {
		const w = Math.min(px.width, cols * 8);
		return sixel(resize(px, w, Math.round((w * px.height) / px.width)));
	}
	// half-blocks: a cell is ~1:2, two pixel rows per cell keeps pixels square
	return blocks(resize(px, cols, Math.round((cols * px.height) / px.width)));
}
