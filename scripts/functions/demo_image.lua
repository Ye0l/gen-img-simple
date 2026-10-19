-- Offline placeholder "generator": draws an SVG from the prompt.
-- Same signature as the real backends, so flows can swap them freely.
--   demo_image { prompt = "...", width = 512, height = 512, seed = 1 } -> { src, seed }

local palette = {
  { "#ff9a8b", "#ff6a88", "#ff99ac" },
  { "#a1c4fd", "#c2e9fb", "#6a85b6" },
  { "#d4fc79", "#96e6a1", "#43e97b" },
  { "#fbc2eb", "#a6c1ee", "#8ec5fc" },
  { "#f6d365", "#fda085", "#f093fb" },
  { "#30cfd0", "#330867", "#5ee7df" },
}

local function esc(s)
  return (s:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;"))
end

-- first n characters (utf-8 aware)
local function clip(s, n)
  local cut = utf8.offset(s, n + 1)
  return cut and (s:sub(1, cut - 1) .. "…") or s
end

return function(p)
  local w, h = p.width or 512, p.height or 512
  local seed = p.seed or math.random(1, 2 ^ 30)
  math.randomseed(seed)
  local c = palette[math.random(#palette)]
  local blobs = {}
  for i = 1, 6 do
    blobs[i] = string.format(
      '<circle cx="%d" cy="%d" r="%d" fill="%s" opacity="%.2f"/>',
      math.random(0, w), math.random(0, h), math.random(w // 8, w // 2.5),
      c[math.random(#c)], 0.35 + math.random() * 0.4
    )
  end
  local svg = string.format([[
<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/>
    </linearGradient>
    <filter id="b"><feGaussianBlur stdDeviation="%d"/></filter>
  </defs>
  <rect width="100%%" height="100%%" fill="url(#g)"/>
  <g filter="url(#b)">%s</g>
  <text x="50%%" y="92%%" text-anchor="middle" font-family="sans-serif" font-size="%d" fill="#fff" opacity=".85">%s</text>
</svg>]], w, h, w, h, c[1], c[2], w // 20, table.concat(blobs), math.max(12, w // 28), esc(clip(p.prompt or "", w // 18)))
  return { src = "data:image/svg+xml;base64," .. encode.base64(svg), seed = seed }
end
