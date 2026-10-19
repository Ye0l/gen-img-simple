<script lang="ts">
	import { runner, type AskCell, type Cell } from '#lib/runtime/runner.svelte.js';
	import { views } from '#lib/views.svelte.js';
	import Ask from './Ask.svelte';
	import Markdown from './Markdown.svelte';

	let { cell }: { cell: Cell } = $props();
	let editing = $state(false);

	function summary(c: AskCell) {
		const opts = c.opts.options ?? [];
		const label = (v: unknown) => opts.find((o) => JSON.stringify(o.value) === JSON.stringify(v))?.label ?? String(v);
		switch (c.kind) {
			case 'confirm':
				return c.answer ? 'Yes' : 'No';
			case 'choose':
				return label(c.answer);
			case 'multi':
				return (c.answer as unknown[]).map(label).join(', ') || '(none)';
			case 'form':
				return Object.entries(c.answer as Record<string, unknown>)
					.map(([k, v]) => `${k}: ${v}`)
					.join(' · ');
			default:
				return String(c.answer ?? '');
		}
	}

	const symbol = $derived.by(() => {
		if (cell.type === 'ask') return cell.answered && !editing ? '◇' : '◆';
		if (cell.type === 'progress') return cell.state === 'done' ? '◇' : cell.state === 'error' ? '■' : '◒';
		if (cell.type === 'error') return '■';
		if (cell.type === 'image') return '▣';
		return '│';
	});

	function focusPreview(src: string) {
		const i = views.preview.findIndex((p) => p.src === src);
		if (i < 0) return;
		views.previewIndex = i;
		if (views.all.preview.enabled) views.all.preview.visible = true;
	}
</script>

<div class="cell {cell.type}" class:active={cell.type === 'ask' && (!cell.answered || editing)}>
	<div class="gutter" class:spin={cell.type === 'progress' && cell.state === 'running'}>{symbol}</div>
	<div class="body">
		{#if cell.type === 'md' || cell.type === 'note'}
			<Markdown text={cell.text} />
		{:else if cell.type === 'ask'}
			<div class="q">
				<span class="label">{cell.opts.label ?? cell.kind}</span>
				{#if cell.opts.hint}<span class="hint">{cell.opts.hint}</span>{/if}
			</div>
			{#if !cell.answered}
				<Ask {cell} onsubmit={(v) => runner.answer(cell as AskCell, v)} />
			{:else if editing}
				<Ask
					{cell}
					onsubmit={(v, keepLater) => {
						editing = false;
						runner.edit(cell as AskCell, v, keepLater);
					}}
					oncancel={() => (editing = false)}
				/>
			{:else}
				<button class="answer" title="클릭해서 수정 → 이 지점부터 다시 실행" onclick={() => (editing = true)}>
					{summary(cell)}
					<span class="edit">✎</span>
				</button>
			{/if}
		{:else if cell.type === 'image'}
			<div class="images">
				{#each cell.images as img, i (i)}
					<figure>
						<button class="thumb" onclick={() => focusPreview(img.src)}>
							<img src={img.src} alt={img.caption ?? ''} />
						</button>
						{#if img.caption}<figcaption>{img.caption}</figcaption>{/if}
					</figure>
				{/each}
			</div>
		{:else if cell.type === 'progress'}
			<span class:dim={cell.state === 'done'} class:err={cell.state === 'error'}>{cell.text}</span>
		{:else if cell.type === 'error'}
			<pre class="err">{cell.text}</pre>
		{/if}
	</div>
	<div class="tools">
		<button title="이 셀부터 다시 실행 (이전 답변·결과 유지)" onclick={() => runner.rerunFrom(cell.logPos)}>↻</button>
	</div>
</div>

<style>
	.cell {
		display: grid;
		grid-template-columns: 1.6rem 1fr auto;
		position: relative;
	}
	.gutter {
		font-family: var(--mono);
		color: var(--fg-3);
		text-align: center;
		line-height: 1.6;
		padding-top: 0.3rem;
		user-select: none;
		position: relative;
		z-index: 1;
	}
	.active .gutter,
	.progress .gutter.spin {
		color: var(--accent);
	}
	.error .gutter,
	.err {
		color: var(--danger);
	}
	.spin {
		animation: pulse 1s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
	.body {
		min-width: 0;
		padding: 0.3rem 0 0.5rem;
		border-left: 1px solid var(--line);
		padding-left: 0.9rem;
		margin-left: -0.8rem;
		line-height: 1.6;
	}
	.note .body {
		color: var(--fg-2);
		font-size: 0.92rem;
	}
	.q .label {
		font-weight: 600;
	}
	.q .hint {
		color: var(--fg-3);
		margin-left: 0.5rem;
		font-size: 0.85rem;
	}
	.answer {
		background: none;
		border: none;
		padding: 0;
		color: var(--fg-2);
		text-align: left;
		white-space: pre-wrap;
		cursor: pointer;
	}
	.answer:hover {
		color: var(--fg);
		text-decoration: underline dotted;
	}
	.edit {
		opacity: 0;
		margin-left: 0.3rem;
		color: var(--accent);
	}
	.answer:hover .edit {
		opacity: 1;
	}
	.images {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.2rem;
	}
	figure {
		margin: 0;
	}
	.thumb {
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
		background: var(--bg-3);
		display: block;
	}
	.thumb img {
		display: block;
		max-width: 260px;
		max-height: 260px;
	}
	figcaption {
		font-size: 0.75rem;
		color: var(--fg-3);
		margin-top: 0.2rem;
	}
	.dim {
		color: var(--fg-2);
	}
	pre.err {
		margin: 0;
		white-space: pre-wrap;
		font-family: var(--mono);
		font-size: 0.85rem;
	}
	.tools {
		opacity: 0;
		transition: opacity 0.1s;
	}
	.cell:hover .tools {
		opacity: 1;
	}
	.tools button {
		background: none;
		border: none;
		color: var(--fg-3);
		padding: 0 0.3rem;
	}
	.tools button:hover {
		color: var(--accent);
	}
</style>
