// Built-in view registry. Every view is hidden by default; scripts decide
// whether a view is available (toggle button), visible, and where it docks.

export type Dock = 'left' | 'right' | 'top' | 'bottom' | 'split';
export const DOCKS: Dock[] = ['left', 'right', 'top', 'bottom', 'split'];

export interface ViewState {
	id: string;
	title: string;
	/** toggle button is shown in the toolbar */
	enabled: boolean;
	visible: boolean;
	dock: Dock;
	/** px for left/right/top/bottom, ratio (0..1) for split */
	size: number;
}

export interface PreviewItem {
	src: string;
	caption?: string;
	at: number;
	/** run session that produced it (a replay replaces its own items) */
	session?: number;
}

const defaults: Record<string, Omit<ViewState, 'id'>> = {
	preview: { title: 'Preview', enabled: false, visible: false, dock: 'right', size: 420 },
	log: { title: 'Log', enabled: false, visible: false, dock: 'bottom', size: 180 },
	editor: { title: 'Editor', enabled: false, visible: false, dock: 'left', size: 520 },
	storage: { title: 'Storage', enabled: false, visible: false, dock: 'right', size: 460 }
};

class Views {
	all = $state<Record<string, ViewState>>(
		Object.fromEntries(Object.entries(defaults).map(([id, v]) => [id, { id, ...v }]))
	);
	preview = $state<PreviewItem[]>([]);
	/** index of the image focused in the preview view */
	previewIndex = $state(0);
	logs = $state<{ level: string; text: string; at: number }[]>([]);

	get(id: string): ViewState {
		const v = this.all[id];
		if (!v) throw new Error(`unknown view: ${id} (available: ${Object.keys(this.all).join(', ')})`);
		return v;
	}

	inDock(dock: Dock) {
		return Object.values(this.all).filter((v) => v.visible && v.dock === dock);
	}

	/** entry point for the Lua `view.*` API */
	apply(op: string, id: string, o: { dock?: Dock; show?: boolean; size?: number } = {}) {
		const v = this.get(id);
		if (o.dock && !DOCKS.includes(o.dock)) throw new Error(`invalid dock: ${o.dock} (${DOCKS.join('|')})`);
		switch (op) {
			case 'enable':
				v.enabled = true;
				if (o.dock) v.dock = o.dock;
				if (o.size) v.size = o.size;
				if (o.show) v.visible = true;
				break;
			case 'disable':
				v.enabled = false;
				v.visible = false;
				break;
			case 'show':
				v.visible = true;
				if (o.dock) v.dock = o.dock;
				break;
			case 'hide':
				v.visible = false;
				break;
			case 'toggle':
				v.visible = !v.visible;
				break;
			case 'dock':
				if (o.dock) v.dock = o.dock;
				break;
			case 'size':
				if (o.size) v.size = o.size;
				break;
			case 'clear':
				if (id === 'preview') this.preview = [];
				if (id === 'log') this.logs = [];
				break;
			default:
				throw new Error(`unknown view op: ${op}`);
		}
	}

	pushImages(items: { src: string; caption?: string }[], session?: number) {
		const at = Date.now();
		this.preview.push(...items.map((i) => ({ ...i, at, session })));
		this.previewIndex = this.preview.length - 1;
	}

	dropSession(session: number) {
		this.preview = this.preview.filter((p) => p.session !== session);
		this.previewIndex = Math.max(0, this.preview.length - 1);
	}

	pushLog(level: string, text: string) {
		this.logs.push({ level, text, at: Date.now() });
		if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000);
	}
}

export const views = new Views();
