// 타입 검사기가 모르는 브라우저/벤더 전역들. 런타임에는 이미 존재 여부를 확인하고 쓰므로
// 여기서는 "있을 수도 있다"고만 알려주면 된다.
interface Window {
    /** Chromium 계열의 화면 색 추출기 (없으면 캔버스 샘플링으로 대체) */
    EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
    /** Safari 구버전 오디오 컨텍스트 */
    webkitAudioContext?: typeof AudioContext;
    /** Capacitor(안드로이드 래핑)에서만 존재 */
    Capacitor?: any;
    /** File System Access API — 지원 브라우저에서만 존재해 'in window'로 확인 후 사용 */
    showSaveFilePicker?: (opts?: any) => Promise<any>;
    showOpenFilePicker?: (opts?: any) => Promise<any[]>;
}

interface ImportMeta {
    env: Record<string, any>;
}
