import { useEffect, type CSSProperties, type ReactNode } from 'react';
import WeatherFx, { useFxSetting } from './WeatherFx';
import FrostFx from './FrostFx';
import LightsFx, { isXmas, LightsDock, useLightsSetting } from './LightsFx';
import { useAccess } from './AuthGate';
import { useWeather, weatherFxOf } from '../lib/weather';
import { createPortal } from 'react-dom';
import type { Member } from '../types';

export function MemberChip({ member, small }: { member?: Member; small?: boolean }) {
  if (!member) return null;
  return (
    <span className={`chip member ${small ? 'chip-sm' : ''}`} style={{ '--c': member.color } as CSSProperties}>
      <i />
      {member.name}
    </span>
  );
}

export function CompanyDot({ color }: { color?: string }) {
  return <span className="dot" style={{ background: color ?? '#999' }} />;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  headExtra,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  headExtra?: ReactNode; // 제목 오른쪽에 넣을 것 (예: 필수 칸)
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  // 창은 화면 맨 바깥(body)에 띄움: 끌어서 옮기는 줄(업체 머리줄 등) 안에서 열려도
  // 글자 긁기·커서가 그 줄의 '끌기'로 잡히지 않게
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          {headExtra && <div className="modal-head-extra">{headExtra}</div>}
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function MemberPicker({
  members,
  value,
  onChange,
}: {
  members: Member[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="picker">
      {members.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            type="button"
            key={m.id}
            className={`chip toggle ${on ? 'on' : ''}`}
            style={{ '--c': m.color } as CSSProperties}
            onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-box">{children}</div>;
}

export function Avatar({ member, size = 40 }: { member?: Member; size?: number }) {
  if (!member) return null;
  return (
    <span className="avatar" style={{ '--c': member.color, width: size, height: size, fontSize: size * 0.3 } as CSSProperties}>
      {member.name.slice(-2)}
    </span>
  );
}

/** 진행 링: 한 가지 값(완료 비율)만 보여줌. 가운데 숫자는 글자색(잉크) */
export function Ring({
  value,
  total,
  size = 76,
  stroke = 7,
  color = 'var(--primary)',
  label,
  sub,
}: {
  value: number;
  total: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: ReactNode;
  sub?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <title>{`${value} / ${total} 완료 (${Math.round(pct * 100)}%)`}</title>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="ring-center">
        <b>{label ?? `${Math.round(pct * 100)}%`}</b>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

/** 노션 커버 자리. 이미지가 정해지면 public/cover.jpg 를 넣고 styles.css 의 .cover 배경만 바꾸면 됨 */
export function Cover({ tall, children }: { tall?: boolean; children?: ReactNode }) {
  // 헤더 날씨 효과: 지금 비 · 눈이 오면 (기상청 · 강수량으로 세기). 관리자가 설정에서 미리보기를 켰으면 그게 먼저
  const { realRole, role } = useAccess();
  const fx = useFxSetting();
  const real = weatherFxOf(useWeather());
  const preview = (realRole === 'admin' || role === null) && fx.mode !== 'off' ? fx : null;
  const show = preview ?? real;
  // 꼬마전구: 크리스마스 기간엔 모두 (각자 끌 수 있음) · 그 밖엔 관리자 미리보기만
  const lights = useLightsSetting();
  const showLights = lights.on && (isXmas() || realRole === 'admin' || role === null);
  return (
    <div className={`cover ${tall ? 'tall' : ''}`}>
      {show && (show.mode === 'frost' ? <FrostFx /> : <WeatherFx mode={show.mode} level={show.level} />)}
      {showLights && <LightsFx palette={lights.palette} blink={lights.blink} strands={lights.strands} />}
      {children}
      {/* 꼬마전구 바로 바꾸기 (헤더 오른쪽 아래, 마우스를 올리면)
          크리스마스 기간: 모두 · 꺼 둬도 다시 켤 수 있게 늘
          그 밖: 관리자가 헤더 설정에서 미리보기를 켰을 때만 (= 크리스마스 기간처럼) · 끄면 안 보임 */}
      {(isXmas() || (showLights && (realRole === 'admin' || role === null))) && <LightsDock />}
    </div>
  );
}

export const CHARACTERS = ['c01', 'c02', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15', 'c16', 'c17']; // c12 개구리 · c17 병아리 (원래 c12 한 장에 같이 있던 것 나눔)
/** 캐릭터 그림 버전: 그림 파일을 바꾸면 숫자를 올림 → 브라우저 · GitHub Pages 에 남은 예전 그림 대신 새 그림을 바로 불러옴 */
const CHAR_VER = 3;
export const characterSrc = (c: string) => `./characters/${c}.png?v=${CHAR_VER}`;

/** 기본 캐릭터 고를 때 쓰는 목록 — 새 캐릭터를 더해도 이미 쓰던 기본 캐릭터가 안 바뀌게 따로 둠 */
export const DEFAULT_CHARS = ['c01', 'c02', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15', 'c16'];
/** 캐릭터: 고른 게 없으면 사람마다 정해진 기본 캐릭터 (id 로 골라서 늘 같음) */
export function charOf(m: { id: string; character?: string }) {
  if (m.character) return m.character;
  let h = 0;
  for (const ch of m.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DEFAULT_CHARS[h % DEFAULT_CHARS.length];
}
