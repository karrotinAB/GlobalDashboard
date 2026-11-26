// 위쪽 '도구함' 버튼: 누르면 드롭다운 (번역 · 출장신청서 · 계약서 …)
import { useEffect, useRef, useState } from 'react';
import { useAccess } from './AuthGate';

/** 도구 목록 (준비 중인 건 ready: false) — 휴대폰 메뉴에서도 씀 */
export const TOOLS: { key: string; label: string; icon: string; href?: string; ready: boolean; adminOnly?: boolean }[] = [
  { key: 'translate', label: '제품번역', icon: '🌐', href: '#/translate', ready: true },
  { key: 'trip', label: '출장신청서', icon: '✈️', href: '#/trip', ready: true },
  { key: 'contract', label: '계약서', icon: '📄', href: '#/contract', ready: true },
  { key: 'coop', label: '업무협조전', icon: '🤝', href: '#/coop', ready: true },
];
/** 관리자 (IT 검토용 계정 빼고 · 로컬 포함) — 준비 중 도구에 들어갈 수 있음 */
export const isToolAdmin = (a: { role: string | null; realRole?: string | null; auditor?: boolean }) => ((a.realRole ?? a.role) === 'admin' && !a.auditor) || a.role === null;

export default function ToolsMenu({ page }: { page: string }) {
  const admin = isToolAdmin(useAccess());
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const active = TOOLS.some((t) => t.key === page);
  return (
    <div className="profile tools" ref={box}>
      <button className={`top-btn ${active || open ? 'active' : ''}`} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        🧰 도구함 <span className="tools-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="profile-menu tools-menu" role="menu">
          {TOOLS.map((t, i) =>
            t.ready || (t.adminOnly && admin) ? (
              <a key={t.key} href={t.href} role="menuitem" className={`${page === t.key ? 'on' : ''} ${t.ready ? '' : 'tools-gray'}`} onClick={() => setOpen(false)} title={t.ready ? undefined : '준비 중 · 관리자만 들어갈 수 있어요'}>
                <span className="tools-n">{i + 1}.</span>
                <span aria-hidden="true">{t.icon}</span> {t.label}
                {!t.ready && <span className="tag gray small">관리자만</span>}
              </a>
            ) : (
              <span key={t.key} className="tools-soon" role="menuitem" aria-disabled="true" title="준비 중이에요">
                <span className="tools-n">{i + 1}.</span>
                <span aria-hidden="true">{t.icon}</span> {t.label}
                <span className="tag gray small">준비 중</span>
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}
