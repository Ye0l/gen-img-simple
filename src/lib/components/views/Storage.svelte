<script lang="ts">
	import { storage } from '#lib/storage.svelte.js';
	import { views } from '#lib/views.svelte.js';

	let tab = $state<'text' | 'secret'>('text');
	let selected = $state<string | null>(null);
	let draft = $state('');
	let filter = $state('');
	let secretName = $state('');
	let secretValue = $state('');

	const names = $derived(
		Object.keys(storage.text)
			.filter((k) => k.toLowerCase().includes(filter.toLowerCase()))
			.sort()
	);

	function pick(name: string) {
		selected = name;
		draft = storage.text[name] ?? '';
	}

	const run = (p: Promise<unknown>) => p.catch((e) => views.pushLog('error', String(e)));

	function addText() {
		const name = prompt('이름 (예: prompts/cat, novelai/negative)');
		if (!name) return;
		run(storage.setText(name, storage.text[name] ?? '').then(() => pick(name)));
	}

	function removeText() {
		if (selected && confirm(`${selected} 삭제?`)) run(storage.deleteText(selected).then(() => (selected = null)));
	}

	function saveSecret() {
		const name = secretName.trim();
		if (!name || !secretValue) return;
		run(storage.setSecret(name, secretValue).then(() => ((secretName = ''), (secretValue = ''))));
	}
</script>

<div class="storage">
	<div class="tabs">
		<button class:on={tab === 'text'} onclick={() => (tab = 'text')}>Text ({Object.keys(storage.text).length})</button>
		<button class:on={tab === 'secret'} onclick={() => (tab = 'secret')}>Secrets ({storage.secrets.length})</button>
	</div>

	{#if tab === 'text'}
		<div class="text">
			<aside>
				<input class="filter" placeholder="filter" bind:value={filter} />
				{#each names as n (n)}
					<button class:on={n === selected} onclick={() => pick(n)}>{n}</button>
				{/each}
				<button class="new" onclick={addText}>+ new</button>
			</aside>
			<section>
				{#if selected && selected in storage.text}
					<div class="bar">
						<code>{selected}</code>
						<button disabled={draft === storage.text[selected]} onclick={() => run(storage.setText(selected!, draft))}>save</button>
						<button class="danger" onclick={removeText}>delete</button>
					</div>
					<textarea bind:value={draft} spellcheck="false"></textarea>
				{:else}
					<div class="empty">Lua: <code>text.get(name, default)</code> · <code>text.set(name, value)</code> · <code>text.list(prefix)</code></div>
				{/if}
			</section>
		</div>
	{:else}
		<div class="secrets">
			<p class="help">
				값은 서버(<code>DATA_DIR/secrets.json</code>)에만 저장되고 다시 읽어올 수 없습니다. 스크립트에서는
				<code>secret("name")</code> 을 http 헤더/본문에 넣으면 서버 프록시가 실제 값으로 바꿔 보냅니다.
			</p>
			<ul>
				{#each storage.secrets as n (n)}
					<li>
						<code>{n}</code><span class="dots">••••••••</span>
						<button onclick={() => ((secretName = n), (secretValue = ''))}>replace</button>
						<button class="danger" onclick={() => confirm(`${n} 삭제?`) && run(storage.deleteSecret(n))}>delete</button>
					</li>
				{:else}
					<li class="empty">저장된 secret 없음</li>
				{/each}
			</ul>
			<div class="add">
				<input placeholder="name (예: novelai)" bind:value={secretName} />
				<input type="password" autocomplete="off" placeholder="value" bind:value={secretValue} />
				<button disabled={!secretName.trim() || !secretValue} onclick={saveSecret}>save</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.storage {
		height: 100%;
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
		min-height: 0;
	}
	.tabs {
		display: flex;
		gap: 0.3rem;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--line);
	}
	.tabs button {
		font-size: 0.78rem;
		padding: 0.15rem 0.6rem;
	}
	.tabs button.on {
		border-color: var(--accent);
		color: var(--accent);
	}
	.text {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	aside {
		width: 170px;
		flex-shrink: 0;
		border-right: 1px solid var(--line);
		overflow: auto;
		padding: 0.4rem 0;
	}
	.filter {
		margin: 0 0.4rem 0.4rem;
		width: calc(100% - 0.8rem);
		font-size: 0.8rem;
		padding: 0.2rem 0.4rem;
	}
	aside button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-radius: 0;
		padding: 0.15rem 0.6rem;
		color: var(--fg-2);
		font-family: var(--mono);
		font-size: 0.78rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	aside button.on {
		background: var(--bg-3);
		color: var(--fg);
	}
	aside .new {
		color: var(--accent);
		margin-top: 0.3rem;
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
	}
	.bar code {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bar button,
	li button,
	.add button {
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
	}
	textarea {
		flex: 1;
		resize: none;
		border: none;
		border-radius: 0;
		font-family: var(--mono);
		font-size: 0.82rem;
		padding: 0.5rem 0.7rem;
		background: var(--bg);
	}
	textarea:focus {
		outline: none;
	}
	.secrets {
		padding: 0.5rem 0.8rem;
		overflow: auto;
	}
	.help,
	.empty {
		color: var(--fg-3);
	}
	section .empty {
		margin: auto;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0;
	}
	li {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		padding: 0.2rem 0;
	}
	.dots {
		flex: 1;
		color: var(--fg-3);
	}
	.add {
		display: flex;
		gap: 0.3rem;
	}
	.add input {
		flex: 1;
		min-width: 0;
		font-size: 0.8rem;
	}
	.danger {
		color: var(--danger);
	}
	code {
		font-family: var(--mono);
		font-size: 0.78rem;
	}
</style>
