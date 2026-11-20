// 생일 한마디: ① 생일인 날 접속하면 '생일자에게 한마디' 팝업 ② 생일자 헤더에 받은 한마디가 말풍선으로
import { useEffect, useMemo, useState } from 'react';
import { useAccess } from './AuthGate';
import { useFullName } from '../lib/fullName';
import { birthdaysOn, useBirthdays, type Birthday } from '../lib/birthdays';
import { markAsked, SAMPLE_MSGS, sendBdayMsg, useBdayMsgs, useBubblePreview, useWishOn, wasAsked, WISH_MAX, WISH_QUICK, type BdayMsg } from '../lib/bdayMsgs';
import { today } from '../lib/date';
import { Modal } from './ui';

/** 관리자 미리보기용: 팝업을 띄우는 신호 */
export const openWishPreview = () => window.dispatchEvent(new Event('gd-wish-popup'));

/** ① 팝업: 오늘 생일인 사람 중 아직 안 물어본 사람 (나 빼고, 이메일 있는 사람) */
export function BirthdayWishPopup() {
  const access = useAccess();
  const on = useWishOn();
  const list = useBirthdays();
  const date = today();
  const me = (access.email ?? '').toLowerCase();
  const myName = useFullName(me) || access.accountName || '';
  const [preview, setPreview] = useState<Birthday | null>(null);
  const [skip, setSkip] = useState<string[]>([]); // 이번에 넘긴 사람
  useEffect(() => {
    const f = () => setPreview({ id: 'preview', name: '미리보기', email: 'preview@example.com', md: '' });
    window.addEventListener('gd-wish-popup', f);
    return () => window.removeEventListener('gd-wish-popup', f);
  }, []);
  const pending = useMemo(
    () => (on && me ? birthdaysOn(list, date).filter((b) => b.email && b.email.toLowerCase() !== me && !wasAsked(date, b.email.toLowerCase()) && !skip.includes(b.id)) : []),
    [on, me, list, date, skip],
  );
  const who = preview ?? pending[0];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!who) return null;
  const close = (asked: boolean) => {
    if (preview) return setPreview(null);
    if (asked && who.email) markAsked(date, who.email.toLowerCase());
    setSkip((x) => [...x, who.id]);
    setText('');
    setErr('');
  };
  const send = async (t: string) => {
    const msg = t.trim().slice(0, WISH_MAX);
    if (!msg) return;
    if (preview) return close(true); // 미리보기는 저장 안 함
    setBusy(true);
    try {
      await sendBdayMsg({ date, to: who.email!.toLowerCase(), toName: who.name, from: me, fromName: myName || me.split('@')[0], text: msg });
      close(true);
    } catch (e) {
      setErr(`보내지 못했어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`🎂 오늘 ${who.name}님 생일이에요`} onClose={() => close(true)}>
      <p className="muted small" style={{ marginTop: 0 }}>
        생일자에게 한마디 남겨 주세요 · {who.name}님 홈 헤더에 말풍선으로 떠요{preview ? ' (미리보기라 저장 안 돼요)' : ''}
      </p>
      <div className="wish-input">
        <input autoFocus maxLength={WISH_MAX} placeholder="생일자에게 한마디 (25자까지)" value={text} onChange={(e) => setText(e.target.value.slice(0, WISH_MAX))} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void send(text)} />
        <span className={`wish-count ${text.length >= WISH_MAX ? 'full' : ''}`}>
          {text.length}/{WISH_MAX}
        </span>
      </div>
      <div className="wish-quick">
        {WISH_QUICK.map((q) => (
          <button key={q} disabled={busy} onClick={() => void send(q)}>
            {q}
          </button>
        ))}
      </div>
      {err && <p className="warn small">{err}</p>}
      <div className="btn-row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button onClick={() => close(true)}>다음에</button>
        <button className="primary" disabled={busy || !text.trim()} onClick={() => void send(text)}>
          보내기
        </button>
      </div>
    </Modal>
  );
}

// 늘 같은 자리 (새로고침해도 같은 배치)
const seeded = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 1000) / 1000;
};

/** ② 헤더 말풍선: 오늘 내가 생일이면 받은 한마디 ("생일축하드려요" -가영) */
export function BirthdayBubbles({ tall }: { tall?: boolean }) {
  const access = useAccess();
  const on = useWishOn();
  const preview = useBubblePreview();
  const list = useBirthdays();
  const date = today();
  const me = (access.email ?? '').toLowerCase();
  const myBday = !!me && birthdaysOn(list, date).some((b) => b.email?.toLowerCase() === me);
  const real = useBdayMsgs(date, on && myBday ? me : null);
  const isAdmin = access.realRole === 'admin' || access.role === null;
  const msgs: BdayMsg[] = preview && isAdmin ? SAMPLE_MSGS : on && myBday ? real : [];
  if (!msgs.length) return null;
  // 헤더를 칸으로 나눠 하나씩 (오른쪽 위 버튼 자리는 피함), 칸 안에서 조금씩 엇갈리게
  // 정해 둔 자리 (헤더 위쪽 · 오른쪽 위 버튼에서 떨어지게, 왼쪽 아래 캐릭터는 피해서) — 최대 11개
  const SLOTS: [number, number][] = tall
    ? [[5, 56], [29, 56], [53, 56], [76, 64], [15, 98], [39, 98], [62, 102], [82, 106], [25, 138], [49, 138], [71, 142]]
    : [[5, 52], [29, 52], [53, 52], [76, 58], [15, 96], [39, 96], [63, 98], [83, 100]];
  const shown = msgs.slice(0, SLOTS.length);
  return (
    <div className="bday-bubbles" aria-label="생일 축하 한마디">
      {shown.map((m, i) => {
        const [left, top] = SLOTS[i];
        const jx = seeded(m.id + 'x') - 0.5; // 아주 조금만 엇갈리게
        const jy = seeded(m.id + 'y') - 0.5;
        return (
          <div key={m.id} className="bday-bubble" style={{ left: `${left + jx * 2}%`, top: top + jy * 6, animationDelay: `${i * 0.1}s` }} title={m.at ? new Date(m.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : ''}>
            <span className="bb-text">“{m.text}”</span> <span className="bb-from">-{m.fromName}</span>
          </div>
        );
      })}
      {msgs.length > shown.length && <div className="bday-bubble-more">+{msgs.length - shown.length}</div>}
    </div>
  );
}
