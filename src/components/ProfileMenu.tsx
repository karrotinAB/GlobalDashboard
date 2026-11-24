// 위쪽 오른쪽 프로필 동그라미: 누르면 이름·이메일 + 설정 · 로그아웃
import { useEffect, useRef, useState } from 'react';
import { logout, useAccess } from './AuthGate';
import { useStore } from '../data/store';
import { DATA_MODE } from '../data/store';
import { startPresent } from './PresentMode';

export default function ProfileMenu() {
  const { email, accountName, role, realRole } = useAccess();
  const isAdmin = (realRole ?? role) === 'admin' || role === null; // IT 발표 모드: 관리자 · 로컬만
  const { data } = useStore();
  const card = [...data.members, ...data.tradeMembers].find((m) => !!email && m.email?.toLowerCase() === email);
  const name = accountName || card?.name || (email ? email.split('@')[0] : '로컬 모드');
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
  return (
    <div className="profile" ref={box}>
      <button className={`profile-btn ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} title={`${name}${email ? ` · ${email}` : ''}`} aria-label="내 계정">
        {/* 사람 모양 */}
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-who">
            <b>{name}</b>
            {email && <span>{email}</span>}
          </div>
          <a href="#/petty" role="menuitem" onClick={() => setOpen(false)}>
            <span aria-hidden="true">💰</span> 전도금
          </a>
          {isAdmin && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                startPresent();
              }}
            >
              <span aria-hidden="true">🎤</span> IT 발표 모드
            </button>
          )}
          <a href="#/settings" role="menuitem" onClick={() => setOpen(false)}>
            <span aria-hidden="true">⚙️</span> 설정
          </a>
          {DATA_MODE !== 'local' && (
            <button role="menuitem" onClick={() => confirm('로그아웃할까요?') && logout()}>
              <span aria-hidden="true">↪</span> 로그아웃
            </button>
          )}
        </div>
      )}
    </div>
  );
}
