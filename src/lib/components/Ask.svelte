<script lang="ts">
	import type { AskCell, Field, Option } from '#lib/runtime/runner.svelte.js';

	let {
		cell,
		onsubmit,
		oncancel
	}: { cell: AskCell; onsubmit: (value: unknown, keepLater?: boolean) => void; oncancel?: () => void } = $props();

	// svelte-ignore state_referenced_locally -- the initial value is all we need
	const o = cell.opts;
	// svelte-ignore state_referenced_locally
	const initial = cell.answered ? cell.answer : o.default;
	const options: Option[] = o.options ?? [];
	const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

	// svelte-ignore state_referenced_locally
	let text = $state(initial == null || cell.kind === 'secret' ? '' : String(initial));
	let num = $state(typeof initial === 'number' ? initial : Number(initial ?? o.min ?? 0));
	let yes = $state(initial == null ? true : !!initial);
	let cursor = $state(Math.max(0, options.findIndex((op) => same(op.value, initial))));
	let picked = $state<boolean[]>(
		options.map((op) => Array.isArray(initial) && initial.some((v) => same(v, op.value)))
	);
	const fieldDefault = (f: Field) => {
		const v = (initial as Record<string, unknown> | undefined)?.[f.name] ?? f.default;
		if (v !== undefined) return v;
		if (f.type === 'number') return f.min ?? 0;
		if (f.type === 'checkbox') return false;
		if (f.type === 'select') return f.options?.[0]?.value;
		return '';
	};
	let fields = $state<Record<string, unknown>>(
		Object.fromEntries((o.fields ?? []).map((f) => [f.name, fieldDefault(f)]))
	);

	let root: HTMLElement;
	$effect(() => {
		root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
	});

	/** when editing an answered cell: re-apply the answers given after it */
	let keepLater = $state(false);

	function submit() {
		const send = (v: unknown) => onsubmit(v, keepLater);
		switch (cell.kind) {
			case 'input':
				if (o.required && !text.trim()) return;
				return send(text);
			case 'secret':
				if (!text.trim()) return;
				return send(text.trim());
			case 'number':
				return send(num);
			case 'confirm':
				return send(yes);
			case 'choose':
				return options[cursor] && send(options[cursor].value);
			case 'multi':
				return send(options.filter((_, i) => picked[i]).map((op) => op.value));
			case 'form':
				return send($state.snapshot(fields));
		}
	}

	function keys(e: KeyboardEvent) {
		if (e.key === 'Escape' && oncancel) return oncancel();
		if (cell.kind === 'choose' || cell.kind === 'multi') {
			if (e.key === 'ArrowDown' || e.key === 'j') cursor = (cursor + 1) % options.length;
			else if (e.key === 'ArrowUp' || e.key === 'k') cursor = (cursor - 1 + options.length) % options.length;
			else if (e.key === ' ' && cell.kind === 'multi') picked[cursor] = !picked[cursor];
			else if (e.key === 'Enter') submit();
			else return;
			e.preventDefault();
		} else if (cell.kind === 'confirm') {
			if (['ArrowLeft', 'ArrowRight', 'h', 'l', 'Tab'].includes(e.key)) yes = !yes;
			else if (e.key === 'y') yes = true;
			else if (e.key === 'n') yes = false;
			else if (e.key === 'Enter') submit();
			else return;
			e.preventDefault();
		} else if (e.key === 'Enter' && (!(e.target instanceof HTMLTextAreaElement) || e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			submit();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ask" bind:this={root} onkeydown={keys}>
	{#if cell.kind === 'secret'}
		<input data-autofocus type="password" autocomplete="off" bind:value={text} placeholder={o.placeholder ?? '••••••••'} />
		<div class="help">서버 저장소에 <code>{o.name}</code> 으로 저장됩니다. 브라우저·로그에는 남지 않아요.</div>
	{:else if cell.kind === 'input'}
		{#if o.multiline}
			<textarea data-autofocus rows="3" bind:value={text} placeholder={o.placeholder}></textarea>
			<div class="help">Ctrl/⌘+Enter 로 제출</div>
		{:else}
			<input data-autofocus bind:value={text} placeholder={o.placeholder} />
		{/if}
	{:else if cell.kind === 'number'}
		<input data-autofocus type="number" bind:value={num} min={o.min} max={o.max} step={o.step} />
	{:else if cell.kind === 'confirm'}
		<div class="confirm" data-autofocus tabindex="0" role="radiogroup">
			<button class:on={yes} onclick={() => ((yes = true), submit())}>● Yes</button>
			<span class="slash">/</span>
			<button class:on={!yes} onclick={() => ((yes = false), submit())}>● No</button>
		</div>
	{:else if cell.kind === 'choose' || cell.kind === 'multi'}
		<ul class="options" data-autofocus tabindex="0" role="listbox">
			{#each options as op, i (i)}
				<!-- svelte-ignore a11y_click_events_have_key_events -- keyboard is handled on the list -->
				<li
					role="option"
					aria-selected={cursor === i}
					class:cursor={cursor === i}
					onmouseenter={() => (cursor = i)}
					onclick={() => {
						cursor = i;
						if (cell.kind === 'multi') picked[i] = !picked[i];
						else submit();
					}}
				>
					<span class="mark">
						{#if cell.kind === 'multi'}{picked[i] ? '◼' : '◻'}{:else}{cursor === i ? '●' : '○'}{/if}
					</span>
					<span class="label">{op.label}</span>
					{#if op.hint}<span class="hint">({op.hint})</span>{/if}
				</li>
			{/each}
		</ul>
		{#if cell.kind === 'multi'}
			<div class="help">↑↓ 이동 · Space 선택 · Enter 확인 <button class="link" onclick={submit}>확인</button></div>
		{/if}
	{:else if cell.kind === 'form'}
		<div class="form">
			{#each o.fields ?? [] as f, i (f.name)}
				<label>
					<span>{f.label ?? f.name}</span>
					{#if f.type === 'number'}
						<input data-autofocus={i === 0 || undefined} type="number" bind:value={fields[f.name]} min={f.min} max={f.max} step={f.step} />
					{:else if f.type === 'checkbox'}
						<input type="checkbox" bind:checked={fields[f.name] as boolean} />
					{:else if f.type === 'select'}
						<select bind:value={fields[f.name]}>
							{#each f.options ?? [] as op (op.value)}<option value={op.value}>{op.label}</option>{/each}
						</select>
					{:else if f.type === 'textarea'}
						<textarea rows="2" bind:value={fields[f.name]} placeholder={f.placeholder}></textarea>
					{:else}
						<input data-autofocus={i === 0 || undefined} bind:value={fields[f.name]} placeholder={f.placeholder} />
					{/if}
				</label>
			{/each}
		</div>
	{/if}

	{#if cell.kind !== 'confirm' && cell.kind !== 'choose'}
		<div class="actions">
			<button class="primary" onclick={submit}>{cell.answered ? '수정 후 재실행' : '확인'} ⏎</button>
			{#if oncancel}<button onclick={oncancel}>취소</button>{/if}
		</div>
	{:else if oncancel}
		<div class="actions"><button onclick={oncancel}>취소 (Esc)</button></div>
	{/if}
	{#if cell.answered && cell.kind !== 'secret'}
		<label class="keep">
			<input type="checkbox" bind:checked={keepLater} />
			이후 답변도 그대로 적용해서 끝까지 진행 (생성은 다시 실행)
		</label>
	{/if}
</div>

<style>
	.ask {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.35rem;
	}
	input:not([type='checkbox']),
	textarea,
	select {
		width: 100%;
		max-width: 640px;
	}
	.options {
		list-style: none;
		margin: 0;
		padding: 0;
		outline: none;
	}
	.options li {
		display: flex;
		gap: 0.5rem;
		padding: 0.15rem 0.3rem;
		cursor: pointer;
		border-radius: 4px;
		color: var(--fg-2);
	}
	.options li.cursor {
		color: var(--fg);
		background: var(--bg-3);
	}
	.options:focus li.cursor .mark {
		color: var(--accent);
	}
	.mark {
		font-family: var(--mono);
		width: 1em;
	}
	.hint {
		color: var(--fg-3);
	}
	.confirm {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		outline: none;
	}
	.confirm button {
		background: none;
		border: none;
		color: var(--fg-3);
		padding: 0.1rem 0.2rem;
	}
	.confirm button.on {
		color: var(--fg);
	}
	.confirm:focus button.on {
		color: var(--accent);
	}
	.slash {
		color: var(--fg-3);
	}
	.form {
		display: grid;
		grid-template-columns: max-content minmax(0, 320px);
		gap: 0.35rem 0.8rem;
		align-items: center;
	}
	.form label {
		display: contents;
	}
	.form label span {
		color: var(--fg-2);
	}
	.actions {
		display: flex;
		gap: 0.4rem;
	}
	.help {
		font-size: 0.8rem;
		color: var(--fg-3);
	}
	.keep {
		font-size: 0.8rem;
		color: var(--fg-3);
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.link {
		background: none;
		border: none;
		color: var(--accent);
		padding: 0;
		margin-left: 0.5rem;
	}
</style>
