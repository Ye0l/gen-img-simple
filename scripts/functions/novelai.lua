-- NovelAI image generation (https://image.novelai.net/ai/generate-image).
-- Needs a Persistent API Token saved as secret "novelai"
-- (novelai.net -> User Settings -> Account -> Get Persistent API Token).
--
--   novelai { prompt = "", negative = "", model = "nai-diffusion-4-5-full",
--             width = 832, height = 1216, steps = 28, scale = 6, sampler = "k_euler_ancestral",
--             seed = nil, n_samples = 1, quality = true, uc_preset = 0,
--             characters = { { prompt = "", uc = "", x = 0.5, y = 0.5 } } }
--   -> { { src, seed }, ... }   (one per sample)
--
-- Request layout follows the web UI (as reimplemented by nekoai-js).

local M = {}

M.secret = "novelai"
M.url = "https://image.novelai.net/ai/generate-image"

M.models = {
  { label = "V4.5 Full", value = "nai-diffusion-4-5-full" },
  { label = "V4.5 Curated", value = "nai-diffusion-4-5-curated" },
  { label = "V4 Full", value = "nai-diffusion-4-full" },
  { label = "V4 Curated", value = "nai-diffusion-4-curated-preview" },
  { label = "V3 (Anime)", value = "nai-diffusion-3" },
  { label = "V3 Furry", value = "nai-diffusion-furry-3" },
}

M.samplers = {
  { label = "Euler Ancestral", value = "k_euler_ancestral" },
  { label = "Euler", value = "k_euler" },
  { label = "DPM++ 2S Ancestral", value = "k_dpmpp_2s_ancestral" },
  { label = "DPM++ 2M SDE", value = "k_dpmpp_2m_sde" },
  { label = "DPM++ 2M", value = "k_dpmpp_2m" },
  { label = "DPM++ SDE", value = "k_dpmpp_sde" },
}

M.sizes = {
  { label = "Portrait 832×1216", value = { 832, 1216 } },
  { label = "Landscape 1216×832", value = { 1216, 832 } },
  { label = "Square 1024×1024", value = { 1024, 1024 } },
  { label = "Small portrait 512×768", value = { 512, 768 }, hint = "Anlas 적게" },
  { label = "Large portrait 1024×1536", value = { 1024, 1536 }, hint = "Anlas 많이" },
}

-- appended to the prompt when quality = true (web UI "Add Quality Tags")
M.quality_tags = {
  ["nai-diffusion-4-5-full"] = "very aesthetic, masterpiece, no text",
  ["nai-diffusion-4-5-curated"] = "location, masterpiece, no text, -0.8::feet::, rating:general",
  ["nai-diffusion-4-full"] = "no text, best quality, very aesthetic, absurdres",
  ["nai-diffusion-4-curated-preview"] = "rating:general, amazing quality, very aesthetic, absurdres",
  ["nai-diffusion-3"] = "best quality, amazing quality, very aesthetic, absurdres",
  ["nai-diffusion-furry-3"] = "{best quality}, {amazing quality}",
}

-- web UI "Undesired Content" preset 0 (Heavy), prepended to the negative prompt
M.uc_presets = {
  ["nai-diffusion-4-5-full"] = "nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
  ["nai-diffusion-4-5-curated"] = "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
}

local function is_v4(model) return model:find("nai%-diffusion%-4") ~= nil end

local function join(a, b)
  if a == nil or a == "" then return b or "" end
  if b == nil or b == "" then return a end
  return a .. ", " .. b
end

--- Rough Anlas estimate; 0 when it fits the Opus free tier (<= 1024x1024, <= 28 steps, 1 sample).
function M.cost(p)
  local w, h, steps, n = p.width or 832, p.height or 1216, p.steps or 28, p.n_samples or 1
  if w * h <= 1024 * 1024 and steps <= 28 and n == 1 then return 0 end
  local res = math.max(w * h, 65536)
  local per = math.ceil(2.951823174884865e-6 * res + 5.753298233447344e-7 * res * steps)
  return per * n
end

function M.generate(p)
  local model = p.model or "nai-diffusion-4-5-full"
  local prompt = p.prompt or ""
  local negative = p.negative or ""
  if p.quality ~= false then prompt = join(prompt, M.quality_tags[model]) end
  if (p.uc_preset or 0) >= 0 then negative = join(M.uc_presets[model], negative) end

  local seed = p.seed or math.random(0, 4294967295)
  local params = {
    params_version = 3,
    width = p.width or 832,
    height = p.height or 1216,
    scale = p.scale or 6,
    sampler = p.sampler or "k_euler_ancestral",
    steps = p.steps or 28,
    n_samples = p.n_samples or 1,
    seed = seed,
    ucPreset = p.uc_preset or 0,
    qualityToggle = p.quality ~= false,
    negative_prompt = negative,
    cfg_rescale = p.cfg_rescale or 0,
    noise_schedule = p.noise_schedule or "karras",
    dynamic_thresholding = false,
    controlnet_strength = 1,
    legacy = false,
    legacy_v3_extend = false,
    add_original_image = true,
    deliberate_euler_ancestral_bug = false,
    prefer_brownian = true,
    characterPrompts = json.array(),
  }

  if is_v4(model) then
    local chars, uchars, coords = json.array(), json.array(), false
    for i, c in ipairs(p.characters or {}) do
      local center = { x = c.x or 0.5, y = c.y or 0.5 }
      if center.x ~= 0.5 or center.y ~= 0.5 then coords = true end
      params.characterPrompts[i] = { prompt = c.prompt, uc = c.uc or "", center = center, enabled = true }
      chars[i] = { char_caption = c.prompt, centers = json.array({ center }) }
      uchars[i] = { char_caption = c.uc or "", centers = json.array({ center }) }
    end
    params.use_coords = coords
    params.legacy_uc = false
    params.v4_prompt = { caption = { base_caption = prompt, char_captions = chars }, use_coords = coords, use_order = true }
    params.v4_negative_prompt = { caption = { base_caption = negative, char_captions = uchars }, legacy_uc = false }
  else
    params.sm = false
    params.sm_dyn = false
  end

  local res = http.post(M.url, { input = prompt, model = model, action = "generate", parameters = params }, {
    headers = { authorization = "Bearer " .. secret(M.secret) },
  })
  if not res.ok then
    local msg = res.json and res.json.message or res.body
    error(string.format("NovelAI HTTP %d: %s", res.status, tostring(msg)), 0)
  end

  local out = {}
  for i, f in ipairs(unzip(res)) do
    out[#out + 1] = { src = f.src, seed = seed + i - 1, name = f.name }
  end
  return out
end

-- novelai { ... } works as a shortcut for novelai.generate { ... }
return setmetatable(M, { __call = function(_, p) return M.generate(p) end })
