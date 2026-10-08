import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedRequire } from './src/runtime.ts';

const tseslint = sharedRequire()('typescript-eslint');
const projectSetting = process.env['DESIGN_LAB_ESLINT_PROJECTS'];
if (!projectSetting) throw new Error('Run ESLint through scripts/lint-tool.ts so shared-cache TypeScript paths are configured.');

export default tseslint.config({
  files: ['**/*.ts'],
  ignores: ['src/generated/**'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: projectSetting.split('|'),
      tsconfigRootDir: resolve(fileURLToPath(new URL('.', import.meta.url))),
    },
  },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/switch-exhaustiveness-check': 'error',
    '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
    '@typescript-eslint/prefer-readonly': 'warn',
    '@typescript-eslint/no-floating-promises': 'error',
  },
});
