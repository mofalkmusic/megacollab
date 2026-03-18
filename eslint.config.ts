// eslint.config.ts
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'
import { globalIgnores } from 'eslint/config'

export default [
	...defineConfigWithVueTs(
		{
			files: ['**/*.{ts,mts,tsx,vue}'],
			rules: {
				indent: ['error', 'tab'],
				'vue/html-indent': ['error', 'tab'],
				'@typescript-eslint/no-unused-vars': [
					'warn',
					{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
				],
				'@typescript-eslint/no-explicit-any': 'off',
			},
		},
		pluginVue.configs['flat/essential'],
		vueTsConfigs.recommended,
		skipFormatting,
	),
	globalIgnores(['**/*.config.js']),
	{
		ignores: ['**/node_modules/**', '**/dist/**', '**/dist_server/**', '**/coverage/**'],
	},
	// FINAL OVERRIDE - applies last, overrides everything above
	{
		files: ['**/*.{ts,vue}'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'vue/multi-word-component-names': 'off',
		},
	},
]
