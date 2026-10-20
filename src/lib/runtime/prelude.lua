-- Host prelude: runs before every flow.
-- Exposes the script-facing API (md, input, choose, image, view, http, ...)
-- on top of the raw `__host` bridge injected from JS.

local H = __host
__host = nil

-- Promise -> value (yields the Lua coroutine until the JS side resolves)
local function await(p)
  return p:await()
end

-- Accepts "label" | { "label", ...positional, key = value }
-- and returns a table with explicit fields only (JS gets a plain object).
local function opts(o, positional)
  if type(o) == "string" then o = { o } end
  o = o or {}
  local r = {}
  for k, v in pairs(o) do
    if type(k) ~= "number" then r[k] = v end
  end
  if r.label == nil then r.label = o[1] end
  if positional and o[2] ~= nil and r[positional] == nil then
    local list = {}
    for i = 2, #o do list[#list + 1] = o[i] end
    r[positional] = list
  end
  return r
end

-- ---------------------------------------------------------------- output

--- Render markdown text as a cell. Usage: md [[ # Title ]]
function md(text)
  H.md(tostring(text))
end

--- Plain text note (rendered as markdown too, but styled dimmer).
function note(text)
  H.note(tostring(text))
end

--- Show one or many images. image(src) | image{ src, caption = "" } | image{ {src=..}, {src=..} }
function image(a, caption)
  local list = {}
  if type(a) == "string" then
    list[1] = { src = a, caption = caption }
  elseif type(a) == "table" and type(a[1]) == "table" then
    for i, it in ipairs(a) do list[i] = { src = it.src or it[1], caption = it.caption } end
  elseif type(a) == "table" then
    list[1] = { src = a.src or a[1], caption = a.caption or caption }
  end
  H.image(list)
end

--- Progress/spinner cell. local p = progress "생성 중..."; p:done "완료" / p:fail "에러" / p:set "50%"
function progress(text)
  local id = H.progress(tostring(text or "..."))
  local p = {}
  function p:set(t) H.progress_update(id, tostring(t), "running") end
  function p:done(t) H.progress_update(id, t and tostring(t) or nil, "done") end
  function p:fail(t) H.progress_update(id, t and tostring(t) or nil, "error") end
  return p
end

--- Goes to the log view (not the chat).
function print(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[#parts + 1] = tostring((select(i, ...))) end
  H.print("info", table.concat(parts, "\t"))
end

log = {
  info = function(...) print(...) end,
  warn = function(s) H.print("warn", tostring(s)) end,
  error = function(s) H.print("error", tostring(s)) end,
}

-- ---------------------------------------------------------------- input
-- Every ask blocks the flow until the user answers in the UI.

--- input "프롬프트?" | input { "프롬프트?", default = "", placeholder = "", multiline = true }
function input(o)
  return await(H.ask("input", opts(o)))
end

--- choose { "모델?", "sdxl", "flux" } | choose { "모델?", options = { {label="SDXL", value="sdxl"} } }
function choose(o)
  return await(H.ask("choose", opts(o, "options")))
end

--- multi { "태그?", "a", "b", "c" } -> { "a", "c" }
function multi(o)
  return await(H.ask("multi", opts(o, "options")))
end

--- confirm "계속할까요?" -> boolean
function confirm(o)
  return await(H.ask("confirm", opts(o)))
end

--- number { "steps?", default = 20, min = 1, max = 150, step = 1 }
function number(o)
  return await(H.ask("number", opts(o)))
end

--- Several fields at once (one cell). form { "설정", fields = { {name="w", type="number", default=512}, ... } }
function form(o)
  return await(H.ask("form", opts(o, "fields")))
end

-- ---------------------------------------------------------------- views
-- Built-in, hidden-by-default UI panels (preview, log, editor ...).
-- dock: "left" | "right" | "top" | "bottom" | "split"

view = {
  --- Make the toggle button appear. view.enable("preview", { dock = "right", show = true })
  enable = function(name, o) H.view("enable", name, o or {}) end,
  disable = function(name) H.view("disable", name, {}) end,
  show = function(name, dock) H.view("show", name, { dock = dock }) end,
  hide = function(name) H.view("hide", name, {}) end,
  toggle = function(name) H.view("toggle", name, {}) end,
  dock = function(name, dock) H.view("dock", name, { dock = dock }) end,
  --- size in px (left/right: width, top/bottom: height) or ratio 0..1 for split
  size = function(name, size) H.view("size", name, { size = size }) end,
  clear = function(name) H.view("clear", name, {}) end,
  list = function() return H.view_list() end,
}

-- ---------------------------------------------------------------- http / utils

http = {}

--- http.request { url = "", method = "POST", headers = {}, body = "" | json = {} , direct = false }
--- -> { status, ok, headers, body, json, data_url }
--- Goes through the SvelteKit server proxy (no CORS issues) unless direct = true.
function http.request(o)
  if type(o) == "string" then o = { url = o } end
  return await(H.http(o))
end

function http.get(url, o)
  o = o or {}; o.url = url; o.method = "GET"
  return http.request(o)
end

function http.post(url, body, o)
  o = o or {}; o.url = url; o.method = "POST"
  if type(body) == "table" then o.json = body else o.body = body end
  return http.request(o)
end

json = {
  encode = function(v) return H.json_encode(v) end,
  decode = function(s) return H.json_decode(s) end,
  --- mark a table as a JSON array (an empty Lua table is otherwise sent as {})
  array = function(t) t = t or {}; t.__array = true; return t end,
}

--- unzip(res | base64) -> { { name, mime, src = data url }, ... }
function unzip(x)
  if type(x) == "table" then x = x.body end
  return await(H.unzip(x))
end

encode = {
  base64 = function(s) return H.b64(s) end,
  uri = function(s) return H.uri(s) end,
}

function sleep(ms)
  await(H.sleep(ms))
end

-- ---------------------------------------------------------------- persistent storage
-- Saved on the server under DATA_DIR. Manage entries in the "storage" view.

--- Secrets (API keys). Values never reach the browser: use secret.ref(name)
--- (or secret(name)) inside http headers/body/url and the server proxy fills it in.
secret = setmetatable({
  has = function(name) return H.secret_has(name) end,
  list = function() return H.secret_list() end,
  ref = function(name) return "{{secret:" .. name .. "}}" end,
  delete = function(name) await(H.secret_delete(name)) end,
  --- ask for the value (password field) and save it. Only asks if missing unless force = true.
  --- secret.ask("novelai", { "NovelAI API 토큰", hint = "..." , force = false })
  ask = function(name, o)
    o = opts(o or name)
    if o.force or not H.secret_has(name) then
      o.name = name
      await(H.ask("secret", o))
    end
    return "{{secret:" .. name .. "}}"
  end,
}, { __call = function(self, name) return self.ref(name) end })

--- Plain text entries (settings, saved prompts ...). Names may contain "/" for grouping.
text = {
  get = function(name, default)
    local v = H.text_get(name)
    if v == nil then return default end
    return v
  end,
  set = function(name, value) await(H.text_set(name, tostring(value))) end,
  delete = function(name) await(H.text_delete(name)) end,
  --- names starting with prefix, sorted
  list = function(prefix) return H.text_list(prefix or "") end,
}

--- Shared key/value store that lives for the whole session (survives re-runs).
store = setmetatable({}, {
  __index = function(_, k) return H.store_get(k) end,
  __newindex = function(_, k, v) H.store_set(k, v) end,
})

-- deterministic randomness: the seed is recorded so replays render the same
math.randomseed(H.seed())

-- ---------------------------------------------------------------- modules
-- require("functions/foo") or require("foo") -> scripts/functions/foo.lua
-- Every file in functions/ is also reachable as a global without require:
--   demo_image { prompt = "..." }

local loaded = {}

function require(name)
  local path = H.resolve(name)
  if not path then error("module not found: " .. tostring(name), 2) end
  local cached = loaded[path]
  if cached ~= nil then return cached end
  local chunk, err = load(H.source(path), "@" .. path, "t", _ENV)
  if not chunk then error(err, 0) end
  local res = chunk(name)
  if res == nil then res = true end
  loaded[path] = res
  return res
end

--- Run another flow inline (its cells continue in the same notebook).
function run(name)
  local path = H.resolve(name, "flows")
  if not path then error("flow not found: " .. tostring(name), 2) end
  local chunk, err = load(H.source(path), "@" .. path, "t", _ENV)
  if not chunk then error(err, 0) end
  return chunk()
end

setmetatable(_G, {
  __index = function(_, k)
    if type(k) ~= "string" then return nil end
    local path = H.resolve_fn(k)
    if path then return require(path) end
    return nil
  end,
})

function __main(path)
  return run(path)
end
