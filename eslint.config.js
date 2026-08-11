import reactHooks from 'eslint-plugin-react-hooks';

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
];
