<script lang="ts">
	import { DOCKS, views, type Dock } from '#lib/views.svelte.js';
	import { viewComponents } from './views';

	let { dock }: { dock: Dock } = $props();

	const list = $derived(views.inDock(dock));
	const vertical = $derived(dock === 'left' || dock === 'right' || dock === 'split');
	const icon: Record<Dock, string> = { left: '◧', right: '◨', top: '⬒', bottom: '⬓', split: '◫' };

	// the dock's size follows its first view
	const size = $derived(list[0]?.size ?? 300);
	// split: size is the share (0..1) next to the notebook, otherwise pixels
	const ratio = $derived(size > 0 && size < 1 ? size : 0.5);
	const px = $derived(size > 1 ? size : 360);
	const style = $derived(
		dock === 'split'
			? `flex: ${ratio / (1 - ratio)} 1 0`
			: vertical
				? `width: ${px}px`
				: `height: ${px}px`
	);

	let el = $state<HTMLElement>();
	function drag(e: PointerEvent) {
		const v = list[0];
		if (!v) return;
		e.preventDefault();
		const parent = el!.parentElement!.getBoundingClientRect();
		const move = (ev: PointerEvent) => {
			const r = el!.getBoundingClientRect();
			if (dock === 'left') v.size = Math.max(160, ev.clientX - r.left);
			else if (dock === 'right') v.size = Math.max(160, r.right - ev.clientX);
			else if (dock === 'top') v.size = Math.max(80, ev.clientY - r.top);
			else if (dock === 'bottom') v.size = Math.max(80, r.bottom - ev.clientY);
			else v.size = Math.min(0.85, Math.max(0.15, (parent.right - ev.clientX) / parent.width));
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
</script>

{#if list.length}
	<div class="dock {dock}" class:vertical {style} bind:this={el}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="handle" onpointerdown={drag}></div>
		{#each list as v (v.id)}
			{@const View = viewComponents[v.id]}
			<div class="panel">
				<div class="head">
					<span class="title">{v.title}</span>
					<span class="docks">
						{#each DOCKS as d (d)}
							<button class:on={v.dock === d} title={d} onclick={() => (v.dock = d)}>{icon[d]}</button>
						{/each}
					</span>
					<button title="hide" onclick={() => (v.visible = false)}>✕</button>
				</div>
				<div class="content"><View /></div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.dock {
		position: relative;
		display: flex;
		flex-direction: row;
		background: var(--bg-2);
		min-width: 0;
		min-height: 0;
		flex-shrink: 0;
	}
	.dock.vertical {
		flex-direction: column;
	}
	.left {
		border-right: 1px solid var(--line);
	}
	.right,
	.split {
		border-left: 1px solid var(--line);
	}
	.top {
		border-bottom: 1px solid var(--line);
	}
	.bottom {
		border-top: 1px solid var(--line);
	}
	.panel {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.panel + .panel {
		border-left: 1px solid var(--line);
	}
	.vertical .panel + .panel {
		border-left: none;
		border-top: 1px solid var(--line);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.4rem 0.2rem 0.7rem;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-3);
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}
	.title {
		flex: 1;
	}
	.head button {
		background: none;
		border: none;
		color: var(--fg-3);
		padding: 0 0.2rem;
		font-size: 0.85rem;
	}
	.head button:hover,
	.head button.on {
		color: var(--fg);
	}
	.docks {
		display: flex;
		opacity: 0.6;
	}
	.head:hover .docks {
		opacity: 1;
	}
	.content {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.handle {
		position: absolute;
		z-index: 2;
	}
	.left .handle {
		right: -3px;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: col-resize;
	}
	.right .handle,
	.split .handle {
		left: -3px;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: col-resize;
	}
	.top .handle {
		bottom: -3px;
		left: 0;
		right: 0;
		height: 6px;
		cursor: row-resize;
	}
	.bottom .handle {
		top: -3px;
		left: 0;
		right: 0;
		height: 6px;
		cursor: row-resize;
	}
</style>
