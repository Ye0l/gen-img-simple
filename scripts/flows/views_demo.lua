-- Shows how a flow can control the built-in views.

md("# Views\n\n웹 UI에는 기본적으로 숨겨진 뷰들이 있습니다: **" .. table.concat(view.list(), ", ") .. "**")
md [[
`view.enable` 로 토글 버튼을 띄우고, `view.show(name, dock)` 으로 위치를 지정합니다.
]]

view.enable("preview")
for _, dock in ipairs({ "right", "bottom", "left", "top", "split" }) do
  view.show("preview", dock)
  local r = demo_image { prompt = "preview @ " .. dock, width = 384, height = 256 }
  image { r.src, caption = dock }
  if not confirm { "preview 가 '" .. dock .. "' 에 있어요. 다음 위치로?", default = true } then break end
end

local hide = confirm { "preview 를 숨길까요?" }
if hide then view.hide("preview") end
md "토글 버튼은 상단에 남아 있습니다. `view.disable` 하면 버튼도 사라져요."
