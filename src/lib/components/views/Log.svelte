<script lang="ts">
	import { views } from '#lib/views.svelte.js';

	let el: HTMLElement;
	$effect(() => {
		void views.logs.length;
		el.scrollTop = el.scrollHeight;
	});
	const time = (t: number) => new Date(t).toLocaleTimeString();
</script>

<div class="log" bind:this={el}>
	{#each views.logs as l, i (i)}
		<div class={l.level}><span class="t">{time(l.at)}</span>{l.text}</div>
	{:else}
		<div class="t">print() / log.warn() / 에러가 여기에 표시됩니다.</div>
	{/each}
</div>

<style>
	.log {
		height: 100%;
		overflow: auto;
		font-family: var(--mono);
		font-size: 0.8rem;
		padding: 0.4rem 0.6rem;
		white-space: pre-wrap;
	}
	.t {
		color: var(--fg-3);
		margin-right: 0.6rem;
	}
	.warn {
		color: var(--warn);
	}
	.error {
		color: var(--danger);
	}
</style>
