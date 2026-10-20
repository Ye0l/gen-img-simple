-- Runs once when the web UI loads.
-- Every built-in view starts hidden; enable the ones you want a toggle for.
-- Flows can call the same functions to show/hide/move views at any point.

view.enable("editor", { dock = "left" })
view.enable("log", { dock = "bottom" })
view.enable("storage", { dock = "right" })
