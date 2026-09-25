// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', 'src/generated/'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.js'],
        },
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  // Plain JS config files (this file) are CommonJS and are not type-checked.
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Must be last: turns off stylistic rules that would fight with Prettier.
  prettierConfig,
);
