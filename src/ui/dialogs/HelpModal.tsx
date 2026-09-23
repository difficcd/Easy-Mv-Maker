import { Settings, Film, Waves, Lasso } from 'lucide-react';
import { tr } from '../../i18n.ts';
import { Modal } from '../Modal.tsx';
import type React from 'react';
import type { Keymap } from '../../core/shortcuts.ts';


// Shortcut and gesture help.
/**
 * Where the features are.
 *
 * Most of what this app does is behind a 12px icon that does not say what is inside it, and the
 * same three things kept being reported as missing: the camera, the mosaic effect, the rotate
 * handle. Each one existed and was three levels down. Finding them meant reading the source.
 *
 * So the icons are drawn here rather than named, because the problem is recognising one on the
 * row - a written "the gear" is only useful to someone who already knows which button that is.
 */
function WhereIsIt() {
    const Ico = ({ children }: { children: React.ReactNode }) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, verticalAlign: '-4px', borderRadius: 4, background: 'hsl(var(--ui-h) var(--ui-s) 24%)', margin: '0 2px' }}>{children}</span>
    );
    const Row = ({ what, where }: { what: React.ReactNode, where: React.ReactNode }) => (
        <div style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
            <span style={{ width: 132, flexShrink: 0, color: '#9aa' }}>{what}</span>
            <span style={{ flex: 1 }}>{where}</span>
        </div>
    );
    const cutGear = <><Ico><Settings size={11} /></Ico> {tr('컷 줄의')}</>;
    const layerFilm = <><Ico><Film size={11} /></Ico> {tr('레이어 줄의')}</>;
    return (
        <>
            <b style={{ color: '#9aa' }}>{tr('이 기능 어디 있나')}</b>
            <Row what={tr('카메라 무브')} where={<>{cutGear} → {tr('카메라')}</>} />
            <Row what={tr('컷 등장·퇴장')} where={<>{cutGear} → {tr('컷 애니메이션')}</>} />
            <Row what={tr('파츠 애니메이션')} where={<>{layerFilm} {tr('(이동·회전·크기·경로)')}</>} />
            <Row what={tr('모자이크 효과')} where={<>{layerFilm} → {tr('모자이크')}</>} />
            <Row what={tr('노이즈 (지지직)')} where={<>{layerFilm} → {tr('노이즈')}</>} />
            <Row what={tr('흔들림 (머리카락)')} where={<>{layerFilm} → {tr('흔들')} · {tr('모양')}</>} />
            <Row what={tr('자글자글 모션')} where={<><Ico><Waves size={11} /></Ico> {tr('레이어 줄의')}</>} />
            <Row what={tr('선택 영역 회전')} where={<><Ico><Lasso size={11} /></Ico> {tr('올가미로 선택 후, 위쪽에 달린 동그란 손잡이를 끄세요')}</>} />
            <div style={{ marginTop: 4, color: '#888' }}>{tr('컷 줄의 아이콘은 그 컷을 먼저 선택해야 보입니다.')}</div>
        </>
    );
}

export function HelpModal({ keymap, onClose }: { keymap: Keymap, onClose: () => void }) {
    return (
        <Modal title={tr('단축키 · 제스처')} onClose={onClose} width={460} maxHeight="80vh"
            panelStyle={{ fontSize: 12.5, color: '#ccc', lineHeight: 1.7 }}>
            {/* First, not last. Shortcuts are reference you look up deliberately; "where is it"
                is what someone opens this dialog *because* of, and at the bottom it was below
                the fold - which is the same failure the section exists to fix. */}
            <WhereIsIt />
            <div style={{ marginTop: 10 }}><b style={{ color: '#9aa' }}>{tr('키보드')}</b></div>
            <div>{tr('Ctrl+Z 실행취소 · Ctrl+Shift+Z / Ctrl+Y 다시실행')}</div>
            <div>{tr('Ctrl+C 컷 복사 · Ctrl+V 붙여넣기 · Ctrl+D 다음 프레임 복제')}</div>
            <div>{tr('Ctrl+S 저장 · Esc 선택 취소 · Enter 선택 적용')}</div>
            <div><b>{keymap.undo}</b> {tr('실행취소 ·')} <b>{keymap.redo}</b> {tr('다시실행 ·')} <b>{keymap.brushDown}</b>/<b>{keymap.brushUp}</b> {tr('브러시 크기 ·')} <b>{keymap.zoomOut}</b>/<b>{keymap.zoomIn}</b> {tr('캔버스 축소/확대 (설정에서 변경)')}</div>
            <div>{tr('move 도구: 빈 곳을 끌면')} <b>{tr('그림 전체가 이동')}</b>{tr('합니다(선택 범위 불필요).')} <b>{tr('Alt+드래그')}</b> {tr('= 활성 레이어만')}</div>
            <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>{tr('펜 / 손가락')}</b></div>
            <div>{tr('펜(S펜)·마우스 = 그리기 / 손가락은 그려지지 않음(팜 리젝션)')}</div>
            <div>{tr('캔버스: 손가락 1개 = 이동, 2개 = 핀치 줌 (우상단 ⟲ 초기화)')}</div>
            <div>PC: <b>{tr('스페이스바 + 드래그 = 화면 이동')}</b> {tr('· 휠 클릭 드래그도 이동 · 휠 = 줌')}</div>
            <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>{tr('타임라인')}</b></div>
            <div>{tr('1손가락 드래그 = 이동, 탭 = 재생위치 / 2손가락 = 확대·축소')}</div>
            <div>PC: <b>{tr('휠(가운데) 클릭 드래그 = 타임라인 이동')}</b></div>
            <div>{tr('컷: 길게 눌러 이동 · 가장자리 드래그로 길이조절 · 더블클릭 이름변경 · Ctrl/Shift+클릭 다중선택')}</div>
            <div style={{ marginTop: 8 }}><b style={{ color: '#9aa' }}>{tr('팁')}</b></div>
            <div>{tr('애니메이션(컷·파츠)은 ▶ 재생 시에만 보입니다. 올가미 → "파츠로 분리"로 부분 애니메이션.')}</div>
            {/* AGPL section 13: anyone using this over a network is owed the source of the
                version they are using. A hosted copy - the previews, or anybody's fork - has to
                say where it is, so the link lives in the app rather than only in the README. */}
            <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid hsl(var(--ui-h) var(--ui-s) 20%)', fontSize: 11, color: '#888' }}>
                Easy MV Maker · <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-soft)' }}>AGPL-3.0</a>
                {' · '}
                <a href="https://github.com/difficcd/Easy-Mv-Maker" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-soft)' }}>{tr('소스 코드')}</a>
            </div>
        </Modal>
    );
}
