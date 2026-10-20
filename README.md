# gen-img-simple

대화형 이미지 생성 Web UI. LLM 없이, **Lua 스크립트(flow)** 가 위에서 아래로 실행되면서
`sv create` 같은 CLI 프롬프트처럼 텍스트를 보여주고 선택/입력을 받습니다.
채팅처럼 생겼지만 동작은 Jupyter notebook에 가깝습니다.

- UI에는 로직이 없습니다. 모든 동작은 `scripts/` 의 Lua 파일입니다.
- `functions/` = 재사용 함수, `flows/` = 함수를 엮은 진행 흐름, `init.lua` = UI 로드 시 1회 실행.
- 지난 답변을 클릭해서 **수정**하면 그 지점부터 다시 진행됩니다 (이전 생성 결과는 재사용).
- 상단 **Editor** 뷰에서 스크립트를 바로 고치고 `re-run` (답변 유지) 할 수 있습니다.

```sh
bun install
bun run dev          # http://localhost:5173
bun run build && bun run start   # production (adapter-node, PORT=3000)
```

## CLI

같은 flow 를 터미널에서 실행합니다 (엔진은 웹과 공유, 프롬프트는 `sv create` 와 같은 clack).

```sh
bun run cli                  # flow 선택
bun run cli novelai          # flows/novelai.lua 실행
bun run cli --runs           # 저장된 실행 목록
bun run cli --resume <id>    # 저장된 실행을 재생하고 멈춘 곳부터 계속
```

- 모든 실행은 `DATA_DIR/runs/<id>.json` 에 자동 저장 (Ctrl+C 로 멈춰도 저장됨).
  웹에서 `/?run=<id>` (또는 첫 화면의 Runs 목록) 로 열면 셀·preview·log 뷰가 그대로 보이고, 이어서 진행할 수 있습니다.
  반대로 웹에서 `save` 한 실행도 `--resume` 으로 CLI 에서 이어갈 수 있습니다.
- 생성 이미지는 `DATA_DIR/out/<id>/` 에 저장되고, 터미널이 지원하면 바로 표시됩니다.
  자동 감지 순서: kitty 그래픽(kitty, ghostty) → iTerm2 인라인(iTerm2, WezTerm) → sixel(터미널에 질의해서 확인, 최신 Termux 등)
  → 트루컬러 반블록(▀, 대부분의 터미널) → 경로만. tmux/screen 안에서는 반블록.
  `--images=kitty|iterm|sixel|blocks|off` 또는 `GENIMG_IMAGES` 로 강제. sixel/반블록은 PNG 만 (SVG 데모 이미지는 경로만).
- view 함수는 CLI 에선 무시됩니다 (실행 기록을 웹에서 열면 적용).

환경 변수: `SCRIPTS_DIR` (기본 `./scripts`), `DATA_DIR` (저장소 위치, 기본 `./data`, git 제외),
`HTTP_ALLOW` (http 프록시가 접근할 host 목록, 비우면 제한 없음), `WEB_URL` (CLI 가 안내하는 웹 주소, 기본 `http://localhost:5173`).

## 샘플

| flow | |
|---|---|
| `txt2img` | 백엔드(demo / A1111) 선택 → 프롬프트 → 스타일 → 생성 반복 |
| `novelai` | NovelAI V4.5 생성. 토큰은 secret, 마지막 프롬프트·저장한 프롬프트는 text 저장소 사용 |
| `views_demo` | preview 뷰를 상하좌우/split 으로 옮겨보기 |

| function | |
|---|---|
| `demo_image{prompt,width,height,seed}` | 오프라인 SVG 플레이스홀더 |
| `a1111{url,prompt,...}` | AUTOMATIC1111/Forge `/sdapi/v1/txt2img` |
| `novelai{prompt,negative,model,width,height,steps,scale,sampler,seed,n_samples,quality,characters}` | NovelAI `image.novelai.net/ai/generate-image` → `{ {src,seed}, ... }`. `novelai.models/samplers/sizes`, `novelai.cost(p)` (Anlas 추정) |
| `generate(backend, params)` | 위 백엔드 디스패처 |
| `styles.list` / `styles.apply(style, prompt)` | 프롬프트 스타일 프리셋 |

NovelAI 는 novelai.net → User Settings → Account → *Get Persistent API Token* 의 토큰이 필요합니다.
flow 가 처음 실행될 때 묻고 secret `novelai` 로 저장합니다.

## Flow 작성

```lua
-- flows/hello.lua  (첫 줄 주석이 flow 목록의 설명이 됩니다)
view.enable("preview")
view.show("preview", "right")

md [[
# Hello
마크다운 문서처럼 씁니다.
]]

local prompt = input { "프롬프트", placeholder = "a cat", multiline = true }
local style  = choose { "스타일", "anime", "photo" }
local ok     = confirm "생성할까요?"

if ok then
  local p = progress "생성 중..."
  local r = demo_image { prompt = prompt }   -- functions/demo_image.lua, require 없이 바로
  p:done "완료"
  image { r.src, caption = style }
end
```

## Lua API (모든 스크립트에서 전역으로 사용 가능)

| 출력 | |
|---|---|
| `md(text)` / `note(text)` | 마크다운 셀 / 흐린 노트 셀 |
| `image(src)` · `image{src, caption=}` · `image{ {src=..}, ... }` | 이미지 셀 + preview 뷰에 추가 |
| `progress(text)` → `p:set(t)`, `p:done(t)`, `p:fail(t)` | 진행 상태 셀 |
| `print(...)`, `log.warn(s)`, `log.error(s)` | log 뷰로 출력 |

| 입력 (사용자가 답할 때까지 대기) | 반환 |
|---|---|
| `input "질문"` · `input{ "질문", default=, placeholder=, multiline=, required= }` | string |
| `choose{ "질문", "a", "b" }` · `choose{ "질문", options={ {label=, value=, hint=} } }` | value |
| `multi{ "질문", "a", "b", "c" }` | value 배열 |
| `confirm "질문"` · `confirm{ "질문", default=false }` | boolean |
| `number{ "질문", default=, min=, max=, step= }` | number |
| `form{ "제목", fields={ {name=, label=, type="text"\|"textarea"\|"number"\|"select"\|"checkbox", default=, options=} } }` | table |

| 저장소 (서버 `DATA_DIR` 에 영구 저장, *Storage* 뷰에서 관리) | |
|---|---|
| `secret.has(name)` / `secret.list()` / `secret.delete(name)` | 비밀키. 값은 브라우저로 돌아오지 않음 |
| `secret.ask(name, { "라벨", force= })` | 없으면 비밀번호 입력칸으로 물어보고 저장. 답은 셀/리플레이 기록에 남지 않음 |
| `secret(name)` / `secret.ref(name)` | `"{{secret:name}}"` 자리표시자. http url/헤더/본문에 넣으면 서버 프록시가 실제 값으로 치환 |
| `text.get(name, default)` / `text.set(name, value)` / `text.delete(name)` / `text.list(prefix)` | 일반 텍스트 (설정, 프롬프트). 이름에 `/` 로 그룹 |
| `store.key = value` | (영구 아님) 세션 동안만 유지되는 값 |

| 뷰 | dock: `"left"` `"right"` `"top"` `"bottom"` `"split"` |
|---|---|
| `view.enable(name, {dock=, show=, size=})` / `view.disable(name)` | 토글 버튼 표시 / 제거 |
| `view.show(name, dock?)` / `view.hide(name)` / `view.toggle(name)` | 표시 |
| `view.dock(name, dock)` / `view.size(name, px 또는 split 비율 0..1)` | 위치/크기 |
| `view.clear(name)` / `view.list()` | |

기본 내장 뷰: `preview` (생성 이미지), `log`, `editor`, `storage`. 모두 기본은 숨김.

| 기타 | |
|---|---|
| `require("name")` | `functions/name.lua` (또는 `flows/x`, 정확한 경로) 로드. `functions/` 의 파일은 require 없이 전역 이름으로도 접근 가능 |
| `run("flows/other")` | 다른 flow를 현재 노트북 안에서 이어서 실행 |
| `http.request{url=, method=, headers=, body= \| json=, direct=}` · `http.get(url)` · `http.post(url, tbl)` | `{status, ok, headers, body, json, data_url}`. 기본은 서버 프록시 경유 (CORS 무관) |
| `unzip(res \| base64)` | zip 응답 풀기 → `{ {name, mime, src}, ... }` |
| `json.encode/decode`, `json.array(t)` (빈 테이블을 `[]` 로 보내기), `encode.base64(s)`, `encode.uri(s)`, `sleep(ms)` | |

## 수정/재실행 동작 (replay)

flow는 결정적으로 다시 실행됩니다. 사용자 답변, http 응답, 난수 seed, sleep, 저장소 읽기는 순서대로 기록되고
(저장소 쓰기는 리플레이 중에는 다시 실행하지 않음),
과거 답변을 수정하면 flow를 처음부터 다시 돌리면서 그 지점까지는 기록을 그대로 돌려줍니다.
그래서 수정 지점 이전의 이미지 생성은 다시 요청되지 않습니다.

- 답변 클릭 → 수정: 그 이후 질문은 이전 답을 기본값으로 다시 묻습니다.
  "이후 답변도 그대로 적용" 체크 시 끝까지 자동 진행 (생성은 새로 실행).
- 셀의 `↻`: 그 셀부터 다시 실행 (예: 생성 결과만 다시 뽑기).
- 상단 `re-run`: 스크립트 수정 후, 기록 전체를 재사용해 다시 실행. 스크립트 흐름이 바뀐 지점부터는 실제 실행.
- 상단 `restart`: 기록 없이 처음부터.

## 구조

```
scripts/                     # 사용자 스크립트 (Editor 뷰에서 편집/저장)
  init.lua
  functions/*.lua
  flows/*.lua
src/lib/runtime/prelude.lua  # Lua 쪽 API 정의 (md, input, view, http ...)
src/lib/runtime/core.ts      # 공용 엔진: wasmoon(Lua 5.4) 실행, 리플레이 로그, host 브리지 (Frontend/Backend 인터페이스)
src/lib/runtime/runner.svelte.ts  # 웹 Frontend: 셀 렌더링, /api 를 쓰는 Backend
cli/main.ts                  # CLI Frontend(clack) + 파일시스템 Backend
cli/term-image.ts            # 터미널 이미지 (kitty/iTerm2/sixel/반블록, PNG 디코더 내장)
src/lib/server/              # scripts, storage, runs, http 프록시 — 순수 node 라 CLI 와 공유 (env.ts 만 SvelteKit 바인딩)
src/lib/views.svelte.ts      # 내장 뷰 레지스트리 (새 뷰: 여기 + components/views/index.ts)
src/lib/components/          # Cell, Ask, Dock, views/*
src/routes/api/scripts       # 스크립트 읽기/저장
src/routes/api/store         # secret(쓰기 전용)/text 저장소 → DATA_DIR/secrets.json, text.json
src/routes/api/http          # http.request 프록시 ({{secret:name}} 치환)
src/routes/api/runs          # 실행 기록 목록/읽기/저장
```
