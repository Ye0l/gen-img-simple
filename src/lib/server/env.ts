// Server singletons bound to the app's environment variables.
import { DATA_DIR, HTTP_ALLOW, SCRIPTS_DIR } from '$app/env/private';
import { createRuns } from './runs.js';
import { createScripts } from './scripts.js';
import { createStorage } from './storage.js';

export const scripts = createScripts(SCRIPTS_DIR);
export const { secrets, texts } = createStorage(DATA_DIR);
export const runs = createRuns(DATA_DIR);
export const allow = HTTP_ALLOW;
