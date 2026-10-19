-- Prompt style presets. styles.apply("cinematic", "a cat") -> "a cat, cinematic lighting, ..."

local M = {}

M.list = {
  { label = "없음", value = "none" },
  { label = "Cinematic", value = "cinematic", hint = "영화 같은 조명" },
  { label = "Anime", value = "anime", hint = "셀 셰이딩 일러스트" },
  { label = "Watercolor", value = "watercolor", hint = "수채화" },
  { label = "Photo", value = "photo", hint = "사진" },
}

local suffix = {
  cinematic = "cinematic lighting, dramatic, 35mm, film grain",
  anime = "anime style, cel shading, vibrant colors",
  watercolor = "watercolor painting, soft edges, paper texture",
  photo = "photograph, natural light, highly detailed",
}

function M.apply(style, prompt)
  local s = suffix[style]
  return s and (prompt .. ", " .. s) or prompt
end

return M
