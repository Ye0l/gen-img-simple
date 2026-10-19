-- AUTOMATIC1111 / Forge WebUI (started with --api).
--   a1111 { url = "http://127.0.0.1:7860", prompt = "", negative = "", width, height, steps, cfg, seed }
--   -> { src, seed }

return function(p)
  local res = http.post((p.url or "http://127.0.0.1:7860") .. "/sdapi/v1/txt2img", {
    prompt = p.prompt,
    negative_prompt = p.negative or "",
    width = p.width or 512,
    height = p.height or 512,
    steps = p.steps or 20,
    cfg_scale = p.cfg or 7,
    seed = p.seed or -1,
    batch_size = 1,
  })
  if not res.ok then error("a1111: HTTP " .. res.status .. " " .. res.body, 0) end
  local info = res.json.info and json.decode(res.json.info) or {}
  return { src = "data:image/png;base64," .. res.json.images[1], seed = info.seed }
end
