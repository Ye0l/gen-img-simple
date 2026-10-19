-- Text -> Image
-- A flow reads top to bottom like a markdown document; every ask
-- (input / choose / number / confirm / form) waits for the user.
-- Answers can be edited later: the flow replays up to that point.

view.enable("preview")
view.show("preview", "right")

md [[
# Text → Image

프롬프트를 입력하면 이미지를 생성합니다.
지난 답변을 클릭하면 **수정**할 수 있고, 그 지점부터 다시 진행됩니다.
]]

local backend = choose {
  "어떤 백엔드를 사용할까요?",
  options = {
    { label = "Demo", value = "demo", hint = "오프라인 플레이스홀더 (SVG)" },
    { label = "AUTOMATIC1111", value = "a1111", hint = "로컬 WebUI --api" },
  },
}

local url
if backend == "a1111" then
  url = input { "WebUI 주소", default = "http://127.0.0.1:7860" }
end

local prompt = input { "프롬프트", placeholder = "a cat astronaut floating in space", multiline = true, required = true }
local style = choose { "스타일", options = styles.list }

local size = form {
  "설정",
  fields = {
    { name = "width", label = "Width", type = "number", default = 512, min = 64, max = 2048, step = 64 },
    { name = "height", label = "Height", type = "number", default = 512, min = 64, max = 2048, step = 64 },
    { name = "count", label = "장수", type = "number", default = 2, min = 1, max = 8 },
  },
}

local final = styles.apply(style, prompt)
note("**prompt:** " .. final)

while true do
  local p = progress(size.count .. "장 생성 중...")
  local results = {}
  for i = 1, size.count do
    p:set(string.format("생성 중... (%d/%d)", i, size.count))
    local r = generate(backend, { url = url, prompt = final, width = size.width, height = size.height })
    results[#results + 1] = { src = r.src, caption = "seed " .. tostring(r.seed) }
  end
  p:done(size.count .. "장 생성 완료")
  image(results)

  local action = choose { "다음은?", "한 번 더", "프롬프트 수정", "끝내기" }
  if action == "끝내기" then break end
  if action == "프롬프트 수정" then
    prompt = input { "새 프롬프트", default = prompt, multiline = true }
    final = styles.apply(style, prompt)
    note("**prompt:** " .. final)
  end
end

md "끝! 위의 답변을 눌러 수정하거나, 상단 **Editor**에서 이 플로우를 고칠 수 있어요."
