import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	SCRIPTS_DIR: {
		description: 'Folder holding init.lua, functions/ and flows/ (default: ./scripts)',
		schema: (v) => v || 'scripts'
	},
	DATA_DIR: {
		description: 'Folder for persistent storage: secrets.json, text.json (default: ./data)',
		schema: (v) => v || 'data'
	},
	HTTP_ALLOW: {
		description: 'Comma separated hosts the http proxy may reach (empty: any host)',
		schema: (v) =>
			(v ?? '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
	}
});
