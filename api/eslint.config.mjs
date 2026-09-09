import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/generated/**'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // Type-aware linting. Without a program, the rules below simply do not
        // run — and they are the ones that catch the dominant bug class in an
        // Express codebase that relies on Express 5 forwarding rejected
        // promises: a handler whose promise nobody awaits, or an async function
        // passed where a sync one is expected, fails silently rather than
        // reaching the error middleware.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', crypto: 'readonly' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      'no-undef': 'off', // TypeScript already checks this, and more accurately.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',

      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        // Express route handlers are typed as returning void, and Express 5
        // handles a returned promise correctly, so only the genuinely dangerous
        // case — an async function used as a condition — is an error here.
        { checksVoidReturn: false },
      ],
      '@typescript-eslint/require-await': 'error',
      // Deliberately NOT enabling no-unnecessary-type-assertion: it flags
      // assertions that narrow a literal before it widens on assignment, and
      // its autofix silently breaks them.
    },
  },
  {
    // Vitest's expect() returns a thenable-looking object in some overloads and
    // the assertion style is deliberately terse; the type-aware promise rules
    // are noise here rather than signal.
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
];
