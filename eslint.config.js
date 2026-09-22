import reactHooks from 'eslint-plugin-react-hooks';
import babelParser from '@babel/eslint-parser';

// Only the hook rules are enabled. The point is not style nagging but catching the silent
// bugs that appear when logic moves into custom hooks:
//  - exhaustive-deps: a missing dependency leaves a stale closure holding an old value
//  - rules-of-hooks: a hook called inside a condition or loop breaks the call order
export default [
    {
        files: ['src/**/*.{js,jsx}'],
        plugins: { 'react-hooks': reactHooks },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
    // The same two rules over the TypeScript files (#268). Only the parser differs: ESLint's own
    // cannot read type annotations, and typescript-eslint's needs the JavaScript compiler API
    // that TypeScript 7 no longer ships - so Babel's parser reads them, with its TypeScript and
    // JSX syntax plugins and no preset: nothing is transformed, only parsed.
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        languageOptions: {
            parser: babelParser,
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: {
                requireConfigFile: false,
                babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'] } },
            },
        },
        rules: {
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
];
