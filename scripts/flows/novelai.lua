-- NovelAI (V4.5) 이미지 생성 — API 토큰과 프롬프트를 저장소에 보관
view.enable("preview")
view.show("preview", "right")

md [[
# NovelAI

NovelAI 이미지 생성 API로 그림을 만듭니다.
토큰은 **secret** 저장소에, 프롬프트는 **text** 저장소에 보관됩니다 (상단 *Storage* 뷰에서 관리).
]]

-- 1. API token (asked once, then kept on the server)
if not secret.has(novelai.secret) then
  md [[
**Persistent API Token** 이 필요합니다.
novelai.net → User Settings → Account → *Get Persistent API Token*
]]
  secret.ask(novelai.secret, { "NovelAI API 토큰", placeholder = "pst-..." })
end

-- 2. prompt: new or from the saved list
local saved = text.list("prompts/")
local prompt
if #saved > 0 then
  local opts = { { label = "새로 입력", value = "" } }
  for _, name in ipairs(saved) do
    opts[#opts + 1] = { label = name:sub(9), value = name, hint = text.get(name):sub(1, 40) }
  end
  local pick = choose { "프롬프트", options = opts }
  if pick ~= "" then prompt = text.get(pick) end
end
prompt = input {
  "프롬프트",
  default = prompt or text.get("novelai/last_prompt", "1girl, solo, smile, looking at viewer, cherry blossoms"),
  multiline = true,
  required = true,
}
local negative = input {
  "네거티브 (UC 프리셋 뒤에 추가)",
  default = text.get("novelai/negative", ""),
  multiline = true,
}
text.set("novelai/last_prompt", prompt)
text.set("novelai/negative", negative)

-- 3. settings
local model = choose { "모델", options = novelai.models }
local size = choose { "해상도", options = novelai.sizes }
local s = form {
  "설정",
  fields = {
    { name = "steps", label = "Steps", type = "number", default = 28, min = 1, max = 50 },
    { name = "scale", label = "Guidance", type = "number", default = 6, min = 0, max = 10, step = 0.1 },
    { name = "sampler", label = "Sampler", type = "select", options = novelai.samplers, default = "k_euler_ancestral" },
    { name = "seed", label = "Seed (0 = 랜덤)", type = "number", default = 0, min = 0 },
    { name = "quality", label = "Quality tags", type = "checkbox", default = true },
  },
}

local function params(seed)
  return {
    prompt = prompt, negative = negative, model = model,
    width = size[1], height = size[2], steps = s.steps, scale = s.scale,
    sampler = s.sampler, quality = s.quality, seed = seed,
  }
end

-- 4. generate loop
local seed = s.seed ~= 0 and s.seed or nil
while true do
  local p = params(seed)
  local cost = novelai.cost(p)
  if cost > 0 and not confirm { string.format("약 %d Anlas 가 소모됩니다. 진행할까요?", cost), default = true } then
    break
  end

  local prog = progress "NovelAI 생성 중..."
  local ok, result = pcall(novelai, p)
  if not ok then
    prog:fail("실패: " .. tostring(result))
    log.error(result)
  else
    prog:done "완료"
    local imgs = {}
    for i, r in ipairs(result) do imgs[i] = { src = r.src, caption = "seed " .. r.seed } end
    image(imgs)
    seed = result[1].seed
  end

  local action = choose {
    "다음은?",
    options = {
      { label = "다시 (새 seed)", value = "again" },
      { label = "같은 seed로 다시", value = "same", hint = "설정 바꾼 뒤 비교할 때" },
      { label = "프롬프트 수정", value = "edit" },
      { label = "프롬프트 저장", value = "save" },
      { label = "끝내기", value = "quit" },
    },
  }
  if action == "quit" then break end
  if action == "again" then seed = nil end
  if action == "edit" then
    prompt = input { "프롬프트", default = prompt, multiline = true, required = true }
    text.set("novelai/last_prompt", prompt)
  end
  if action == "save" then
    local name = input { "저장할 이름", placeholder = "예: sakura_girl", required = true }
    text.set("prompts/" .. name, prompt)
    note("`prompts/" .. name .. "` 에 저장했어요.")
  end
end

md "끝! 지난 답변을 눌러 수정하면 그 지점부터 다시 진행됩니다."
