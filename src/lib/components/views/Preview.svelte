<script lang="ts">
	import { views } from '#lib/views.svelte.js';

	const current = $derived(views.preview[views.previewIndex]);

	function keys(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') views.previewIndex = Math.max(0, views.previewIndex - 1);
		else if (e.key === 'ArrowRight') views.previewIndex = Math.min(views.preview.length - 1, views.previewIndex + 1);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="preview" tabindex="0" onkeydown={keys} role="region" aria-label="preview">
	{#if current}
		<div class="stage">
			<img src={current.src} alt={current.caption ?? ''} />
		</div>
		<div class="meta">
			<span>{views.previewIndex + 1} / {views.preview.length}</span>
			{#if current.caption}<span class="cap">{current.caption}</span>{/if}
			<a href={current.src} download="image-{current.at}">download</a>
		</div>
		<div class="strip">
			{#each views.preview as p, i (i)}
				<button class:on={i === views.previewIndex} onclick={() => (views.previewIndex = i)}>
					<img src={p.src} alt="" />
				</button>
			{/each}
		</div>
	{:else}
		<div class="empty">생성된 이미지가 여기에 표시됩니다.</div>
	{/if}
</div>

<style>
	.preview {
		height: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.6rem;
		outline: none;
		min-height: 0;
	}
	.stage {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: repeating-conic-gradient(var(--bg-3) 0 25%, var(--bg-2) 0 50%) 0 0 / 16px 16px;
		border-radius: 8px;
		overflow: hidden;
	}
	.stage img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}
	.meta {
		display: flex;
		gap: 0.8rem;
		font-size: 0.8rem;
		color: var(--fg-3);
	}
	.meta .cap {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--fg-2);
	}
	.meta a {
		color: var(--accent);
	}
	.strip {
		display: flex;
		gap: 0.3rem;
		overflow-x: auto;
		flex-shrink: 0;
	}
	.strip button {
		padding: 0;
		border: 2px solid transparent;
		border-radius: 5px;
		overflow: hidden;
		flex-shrink: 0;
		background: none;
	}
	.strip button.on {
		border-color: var(--accent);
	}
	.strip img {
		display: block;
		height: 48px;
	}
	.empty {
		margin: auto;
		color: var(--fg-3);
		font-size: 0.9rem;
	}
</style>
