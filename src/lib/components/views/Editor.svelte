<script lang="ts">
	import { runner } from '#lib/runtime/runner.svelte.js';
	import { scripts } from '#lib/scripts.svelte.js';
	import { views } from '#lib/views.svelte.js';

	let current = $state<string | null>(null);
	let busy = $state(false);

	// follow the running flow unless the user picked another file
	$effect(() => {
		const f = runner.flow && scripts.resolve(runner.flow, 'flows');
		if (!current && f) current = f;
	});
	$effect(() => {
		if (!current && scripts.paths.length) current = scripts.paths[0];
	});

	async function save() {
		if (!current) return;
		busy = true;
		try {
			await scripts.save(current);
		} catch (e) {
			views.pushLog('error', String(e));
		} finally {
			busy = false;
		}
	}

	function create() {
		const name = prompt('새 파일 경로 (예: functions/upscale.lua, flows/my_flow.lua)');
		if (name) current = scripts.create(name, `-- ${name}\n`);
	}

	async function remove() {
		if (!current || !confirm(`${current} 삭제?`)) return;
		if (current in scripts.saved) await scripts.remove(current);
		else delete scripts.files[current];
		current = null;
	}

	function keys(e: KeyboardEvent) {
		const ta = e.currentTarget as HTMLTextAreaElement;
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			save();
		} else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			runner.rerun();
		} else if (e.key === 'Tab') {
			e.preventDefault();
			ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
			ta.dispatchEvent(new Event('input'));
		}
	}

	const groups = $derived(
		Object.entries(
			Object.groupBy(scripts.paths, (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.'))
		)
	);
</script>

<div class="editor">
	<aside>
		{#each groups as [dir, files] (dir)}
			<div class="dir">{dir}/</div>
			{#each files ?? [] as f (f)}
				<button class:on={f === current} onclick={() => (current = f)}>
					{f.slice(f.lastIndexOf('/') + 1)}{scripts.isDirty(f) ? ' •' : ''}
				</button>
			{/each}
		{/each}
		<button class="new" onclick={create}>+ new</button>
	</aside>
	<section>
		{#if current && current in scripts.files}
			<div class="bar">
				<span class="path">{current}</span>
				<button onclick={save} disabled={busy || !scripts.isDirty(current)} title="Ctrl/⌘+S">save</button>
				<button onclick={() => runner.rerun()} disabled={!runner.flow} title="답변을 유지한 채 재실행 (Ctrl/⌘+Enter)">
					re-run
				</button>
				{#if current.startsWith('flows/')}
					<button onclick={() => runner.start(current!)}>run fresh</button>
				{/if}
				<button class="danger" onclick={remove}>delete</button>
			</div>
			<textarea spellcheck="false" bind:value={scripts.files[current]} onkeydown={keys}></textarea>
		{/if}
	</section>
</div>

<style>
	.editor {
		display: flex;
		height: 100%;
		min-height: 0;
	}
	aside {
		width: 150px;
		flex-shrink: 0;
		border-right: 1px solid var(--line);
		overflow: auto;
		padding: 0.4rem 0;
		font-size: 0.82rem;
	}
	.dir {
		color: var(--fg-3);
		padding: 0.4rem 0.6rem 0.1rem;
		font-family: var(--mono);
	}
	aside button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-radius: 0;
		padding: 0.15rem 0.6rem 0.15rem 1rem;
		color: var(--fg-2);
		font-family: var(--mono);
	}
	aside button.on {
		background: var(--bg-3);
		color: var(--fg);
	}
	aside .new {
		color: var(--accent);
		margin-top: 0.4rem;
	}
	section {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.bar {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--line);
		font-size: 0.8rem;
	}
	.bar .path {
		flex: 1;
		font-family: var(--mono);
		color: var(--fg-2);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bar button {
		font-size: 0.75rem;
		padding: 0.15rem 0.5rem;
	}
	.danger {
		color: var(--danger);
	}
	textarea {
		flex: 1;
		resize: none;
		border: none;
		border-radius: 0;
		font-family: var(--mono);
		font-size: 0.82rem;
		line-height: 1.5;
		padding: 0.6rem 0.8rem;
		tab-size: 2;
		white-space: pre;
		background: var(--bg);
	}
	textarea:focus {
		outline: none;
	}
</style>
