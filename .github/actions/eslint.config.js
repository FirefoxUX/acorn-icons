import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import ts from 'typescript-eslint'
import { defineConfig } from 'eslint/config'
import globals from 'globals'

export default defineConfig(
  // js
  js.configs.recommended,
  // ts
  ts.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    languageOptions: {
      parserOptions: {},
    },
  },
  prettierConfig,
  {
    languageOptions: {
      globals: {
        ...globals.nodeBuiltin,
        ...globals.browser,
        $$Generic: 'readonly',
      },
    },
    ignores: ['**/*.config.js'],
  },
  {
    files: ['**/*.stories.svelte'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/generated/graphql.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
