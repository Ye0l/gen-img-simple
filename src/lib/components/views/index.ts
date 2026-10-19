import type { Component } from 'svelte';
import Editor from './Editor.svelte';
import Log from './Log.svelte';
import Preview from './Preview.svelte';

/** view id -> component. Add a view here and in views.svelte.ts defaults. */
export const viewComponents: Record<string, Component> = {
	preview: Preview,
	log: Log,
	editor: Editor
};
