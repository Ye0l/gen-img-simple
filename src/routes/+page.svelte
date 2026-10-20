<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Cell from '#lib/components/Cell.svelte';
	import Dock from '#lib/components/Dock.svelte';
	import { runner } from '#lib/runtime/runner.svelte.js';
	import { scripts } from '#lib/scripts.svelte.js';
	import { storage } from '#lib/storage.svelte.js';
	import { views } from '#lib/views.svelte.js';

	let error = $state<string | null>(null);
	let scroller = $state<HTMLElement>();
	let runs = $state<{ id: string; flow: string; origin: string; status: string; updated: number; steps: number }[]>([]);

	const setUrl = (q: string) => goto(`?${q}`, { shallow: true, replace: true, state: {} });

	onMount(async () => {
		try {
			await Promise.all([scripts.load(), storage.load()]);
			await runner.boot();
			const run = page.url.searchParams.get('run');
			const flow = page.url.searchParams.get('flow');
			if (run) await runner.open(run);
			else if (flow) runner.start(flow);
			else runs = (await (await fetch('/api/runs')).json()).runs;
		} catch (e) {
			error = String(e);
		}
	});

	function open(flow: string) {
		setUrl(`flow=${encodeURIComponent(flow)}`);
		runner.start(flow);
	}

	function openRun(id: string) {
		setUrl(`run=${encodeURIComponent(id)}`);
		runner.open(id).catch((e) => (error = String(e)));
	}

	async function save() {
		await runner.save();
		setUrl(`run=${encodeURIComponent(runner.runId!)}`);
	}

	const name = (p: string) => p.replace(/^flows\//, '').replace(/\.lua$/, '');
	const enabled = $derived(Object.values(views.all).filter((v) => v.enabled));

	// keep the newest cell in view
	$effect(() => {
		void runner.cells.length;
		tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }));
	});
</script>

<div class="app">
	<header>
		<span class="logo">◆ gen-img</span>
		<select value={runner.flow ?? ''} onchange={(e) => open(e.currentTarget.value)}>
			<option value="" disabled>flow 선택…</option>
			{#each scripts.flows as f (f)}<option value={f}>{name(f)}</option>{/each}
		</select>
		{#if runner.flow}
			<button onclick={() => runner.start(runner.flow!)} title="처음부터 새로 실행">restart</button>
			<button onclick={() => runner.rerun()} title="답변/결과를 유지한 채 스크립트만 다시 실행">re-run</button>
			{#if runner.status === 'running' || runner.status === 'waiting'}
				<button onclick={() => runner.stop()}>stop</button>
			{/if}
			<button onclick={save} title="실행 기록 저장 (이후 자동 저장, CLI에서 --resume 가능)">
				{runner.runId ? 'saved' : 'save'}
			</button>
			<span class="status {runner.status}">{runner.replaying ? 'replaying' : runner.status}</span>
			{#if runner.runId}<span class="status" title="saved run">{runner.runId}</span>{/if}
		{/if}
		<span class="spacer"></span>
		{#each enabled as v (v.id)}
			<button class="toggle" class:on={v.visible} onclick={() => (v.visible = !v.visible)}>{v.title}</button>
		{/each}
	</header>

	<Dock dock="top" />
	<div class="middle">
		<Dock dock="left" />
		<main bind:this={scroller}>
			<div class="notebook">
				{#if error}
					<pre class="err">{error}</pre>
				{:else if !runner.flow}
					<div class="intro">
						<h1>Flows</h1>
						<p>scripts/flows/*.lua — 하나를 선택해서 시작하세요.</p>
						<div class="cards">
							{#each scripts.flows as f (f)}
								<button onclick={() => open(f)}>
									<strong>{name(f)}</strong>
									<span>{scripts.files[f].match(/^--\s*(.*)$/m)?.[1] ?? ''}</span>
								</button>
							{/each}
						</div>
						{#if runs.length}
							<h1>Runs</h1>
							<p>저장된 실행 기록 (CLI 실행 포함) — 열면 그대로 재생되고, 멈춘 곳부터 이어서 진행할 수 있어요.</p>
							<ul class="runs">
								{#each runs.slice(0, 30) as r (r.id)}
									<li>
										<button onclick={() => openRun(r.id)}>{r.id}</button>
										<span>{name(r.flow)} · {r.origin} · {r.status} · 답변 {r.steps}개 · {new Date(r.updated).toLocaleString()}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{:else}
					<div class="cell-head">┌ {name(runner.flow)}</div>
					{#each runner.cells as cell (cell.id)}
						<Cell {cell} />
					{/each}
					{#if runner.status === 'done'}<div class="cell-head">└ done</div>{/if}
					{#if runner.status === 'stopped'}<div class="cell-head">└ stopped</div>{/if}
				{/if}
			</div>
		</main>
		<Dock dock="split" />
		<Dock dock="right" />
	</div>
	<Dock dock="bottom" />
</div>

<style>
	.app {
		height: 100vh;
		display: flex;
		flex-direction: column;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.8rem;
		border-bottom: 1px solid var(--line);
		background: var(--bg-2);
		font-size: 0.85rem;
		flex-shrink: 0;
	}
	.logo {
		font-family: var(--mono);
		color: var(--accent);
		margin-right: 0.4rem;
	}
	.spacer {
		flex: 1;
	}
	.status {
		font-family: var(--mono);
		font-size: 0.75rem;
		color: var(--fg-3);
	}
	.status.waiting,
	.status.running {
		color: var(--accent);
	}
	.status.error {
		color: var(--danger);
	}
	.toggle.on {
		border-color: var(--accent);
		color: var(--accent);
	}
	.middle {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	main {
		flex: 1 1 0;
		min-width: 0;
		overflow: auto;
	}
	.notebook {
		max-width: 820px;
		margin: 0 auto;
		padding: 1.5rem 1.2rem 40vh;
	}
	.cell-head {
		font-family: var(--mono);
		color: var(--fg-3);
		padding-left: 0.45rem;
	}
	.intro h1 {
		font-size: 1.3rem;
	}
	.intro p {
		color: var(--fg-2);
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 0.6rem;
	}
	.cards button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
		text-align: left;
		padding: 0.8rem 1rem;
		background: var(--bg-2);
	}
	.cards span {
		color: var(--fg-3);
		font-size: 0.85rem;
	}
	.runs {
		list-style: none;
		padding: 0;
		font-size: 0.85rem;
	}
	.runs li {
		display: flex;
		gap: 0.8rem;
		align-items: baseline;
		padding: 0.15rem 0;
	}
	.runs button {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		font-family: var(--mono);
	}
	.runs span {
		color: var(--fg-3);
	}
	.err {
		color: var(--danger);
		white-space: pre-wrap;
	}
</style>
