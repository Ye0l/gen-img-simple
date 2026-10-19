<script lang="ts">
	import { marked } from 'marked';

	let { text }: { text: string } = $props();
	// scripts are local, trusted files: raw HTML in markdown is allowed on purpose
	const html = $derived(marked.parse(text, { async: false, gfm: true, breaks: true }));
</script>

<div class="md">{@html html}</div>

<style>
	.md :global(:first-child) {
		margin-top: 0;
	}
	.md :global(:last-child) {
		margin-bottom: 0;
	}
	.md :global(h1) {
		font-size: 1.35rem;
		margin: 0 0 0.5rem;
	}
	.md :global(h2) {
		font-size: 1.15rem;
	}
	.md :global(h3) {
		font-size: 1rem;
	}
	.md :global(p) {
		margin: 0.35rem 0;
	}
	.md :global(code) {
		font-family: var(--mono);
		font-size: 0.85em;
		background: var(--bg-3);
		padding: 0.1em 0.35em;
		border-radius: 4px;
	}
	.md :global(pre) {
		background: var(--bg-3);
		padding: 0.6rem 0.8rem;
		border-radius: 6px;
		overflow: auto;
	}
	.md :global(pre code) {
		background: none;
		padding: 0;
	}
	.md :global(a) {
		color: var(--accent);
	}
	.md :global(img) {
		max-width: 100%;
	}
</style>
