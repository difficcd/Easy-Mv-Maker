import reactHooks from 'eslint-plugin-react-hooks';

// 훅 전용 검사만 켠다. 목적은 코드 스타일 잔소리가 아니라,
// 로직을 커스텀 훅으로 옮길 때 생기는 '조용한 버그'를 잡는 것:
//  - exhaustive-deps: 의존성 배열 누락 → 오래된 값을 붙든 채 도는 stale closure
//  - rules-of-hooks: 조건문/반복문 안에서 훅 호출 → 호출 순서가 깨짐
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
