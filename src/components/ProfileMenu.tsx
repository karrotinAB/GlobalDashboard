// 위쪽 오른쪽 프로필 동그라미: 누르면 이름·이메일 + 설정 · 로그아웃
import { useEffect, useRef, useState } from 'react';
import { logout, useAccess } from './AuthGate';
import { useStore } from '../data/store';
import { DATA_MODE } from '../data/store';

export default function ProfileMenu() {
  const { email, accountName } = useAccess();
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
  const initial = name.replace(/^[가-힣](?=[가-힣]{2}$)/, '').slice(0, 2);
  return (
    <div className="profile" ref={box}>
      <button className="profile-btn" style={{ background: card?.color ?? '#8c2f3c' }} onClick={() => setOpen((v) => !v)} title={`${name}${email ? ` · ${email}` : ''}`} aria-label="내 계정">
        {initial}
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-who">
            <b>{name}</b>
            {email && <span>{email}</span>}
          </div>
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
