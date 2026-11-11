import { useEffect, useState, type CSSProperties } from 'react';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useLookups, useStore } from '../data/store';
import { useAccess } from './AuthGate';

interface Seen {
  email: string;
  page: string;
  at: number; // 마지막으로 "보는 중" 신호를 보낸 시각 (ms)
}

const BEAT = 40_000; // 40초마다 "보는 중" 신호
const ALIVE = 95_000; // 이 안에 신호가 있으면 지금 보는 중

const PAGE_NAME: Record<string, string> = {
  home: '홈',
  todos: '주간 할일',
  orders: '주문 관리',
  claims: '클레임',
  settings: '설정',
  requests: '무역사무요청',
  thome: '무역사무 홈',
  twork: '무역사무 업무',
};

/** 지금 이 페이지를 보고 있는 사람 (presence/{이메일} 문서). 로그인한 Firebase 모드에서만 */
export default function Presence({ page }: { page: string }) {
  const me = useAccess();
  const { members: team } = useLookups();
  const members = [...team, ...useStore().data.tradeMembers];
  const [all, setAll] = useState<Seen[]>([]);
  const [, tick] = useState(0);

  // 내 "보는 중" 신호 보내기
  useEffect(() => {
    if (!me.email) return;
    const ref = doc(db, 'presence', me.email);
    const beat = () => {
      if (document.visibilityState === 'visible') setDoc(ref, { email: me.email, page, at: Date.now() }).catch(() => {});
    };
    beat();
    const id = setInterval(beat, BEAT);
    const onVis = () => (document.visibilityState === 'visible' ? beat() : setDoc(ref, { email: me.email, page: '', at: Date.now() }).catch(() => {}));
    const onLeave = () => deleteDoc(ref).catch(() => {});
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onLeave);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onLeave);
    };
  }, [me.email, page]);

  // 다른 사람 신호 듣기 (보안 규칙이 아직 없으면 조용히 아무것도 안 보여줌)
  useEffect(() => {
    if (!me.email) return;
    return onSnapshot(
      collection(db, 'presence'),
      (snap) => setAll(snap.docs.map((d) => d.data() as Seen)),
      () => setAll([]),
    );
  }, [me.email]);

  // 오래된 신호가 사라지도록 20초마다 다시 그림
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  if (!me.email) return null;
  const now = Date.now();
  const here = all
    .filter((s) => s.page === page && now - s.at < ALIVE)
    .sort((a, b) => (a.email === me.email ? 1 : b.email === me.email ? -1 : a.email.localeCompare(b.email)));
  if (!here.length) return null;

  return (
    <div className="presence" title={`지금 ${PAGE_NAME[page.split(':').pop()!] ?? '이 페이지'}를 보고 있는 사람`}>
      {here.map((s) => {
        const m = members.find((x) => x.email?.toLowerCase() === s.email);
        const name = m?.name ?? s.email.split('@')[0];
        const isMe = s.email === me.email;
        return (
          <span
            key={s.email}
            className={`pres-dot ${isMe ? 'me' : ''}`}
            style={{ '--c': m?.color ?? '#9c8480' } as CSSProperties}
            title={`${name}${isMe ? ' (나)' : ''} · ${PAGE_NAME[page.split(':').pop()!] ?? ''} 보는 중`}
          >
            {name.slice(0, 2)}
          </span>
        );
      })}
      <span className="pres-label">보는 중</span>
    </div>
  );
}
