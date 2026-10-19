-- Backend dispatcher: generate(backend, params) -> { src, seed }
-- Add a backend by dropping a file in functions/ and listing it here.

local backends = {
  demo = demo_image, -- functions are globals, no require needed
  a1111 = require("a1111"), -- ...or require them explicitly
}

return function(backend, params)
  local fn = backends[backend]
  if not fn then error("unknown backend: " .. tostring(backend), 0) end
  return fn(params)
end
