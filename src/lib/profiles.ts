// 사람 정보 한 곳: profiles/{이메일} = { name, character, color, status, clocks, memName, home, updatedAt }
//   모든 대시보드(1~3조 · 무역사무 · 팀장님/이사님)의 담당자 카드는 이메일이 같으면 이 정보를 덮어써서 보여줌
//   카드를 고치면 (말풍선 · 캐릭터 · 시계 · 색 · 이름 · mem 이름) 예전 카드에도, 여기에도 같이 저장 → 되돌릴 수 있게
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { ClockPick, Member } from '../types';

export interface Profile {
  name?: string;
  character?: string;
  color?: string;
  status?: string;
  clocks?: ClockPick[];
  memName?: string;
  lights?: { on: boolean; palette: string; blink: string }; // 헤더 꼬마전구 설정 (광장 크리스마스 지붕)
  home?: string; // 처음 모은 카드가 있던 곳 (1 · 2 · 3 · trade · p… ) — 확인용
  updatedAt?: string;
}
export const PROFILE_KEYS = ['name', 'character', 'color', 'status', 'clocks', 'memName'] as const;

const isLocal = import.meta.env.VITE_DATA_MODE === 'local';
const LS = 'gd:profiles';

// 앱 전체가 같이 쓰는 한 벌 (구독은 한 번만)
let cache: Record<string, Profile> = {};
let ready = false;
const listeners = new Set<() => void>();
let started = false;
const emit = () => listeners.forEach((f) => f());
function start() {
  if (started) return;
  started = true;
  if (isLocal) {
    try {
      cache = JSON.parse(localStorage.getItem(LS) ?? '{}') as Record<string, Profile>;
    } catch {
      cache = {};
    }
    ready = true;
    emit();
    return;
  }
  onSnapshot(
    collection(db, 'profiles'),
    (snap) => {
      cache = Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as Profile]));
      ready = true;
      emit();
    },
    () => {
      ready = true;
      emit();
    },
  );
}

/** 모든 사람 정보 (이메일 → 정보). 로그인 전에는 부르지 않음 */
export function useProfiles(enabled = true): { profiles: Record<string, Profile>; ready: boolean } {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    start();
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    f();
    return () => {
      listeners.delete(f);
    };
  }, [enabled]);
  return { profiles: cache, ready };
}

const low = (e?: string) => (e ?? '').trim().toLowerCase();
/** 카드 위에 사람 정보 덮기 (이메일 없는 카드는 그대로) */
export function withProfile<T extends Member>(m: T, profiles: Record<string, Profile>): T {
  const p = m.email ? profiles[low(m.email)] : undefined;
  if (!p) return m;
  const out = { ...m } as T;
  for (const k of PROFILE_KEYS) {
    const v = p[k];
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  // 말풍선은 지운 것도 반영 (빈 말풍선)
  if (p.status === '') delete (out as Record<string, unknown>).status;
  return out;
}

/** 카드를 저장할 때 사람 정보에도 (실패해도 카드 저장은 그대로) */
export async function saveProfileFrom(m: Member, home?: string) {
  const email = low(m.email);
  if (!email) return;
  // 사람 정보가 아직 없는 사람(새로 온 사람): 처음 만드는 건 관리자만 (규칙) — 조원이 저장하면 카드에만 저장됨
  const v: Profile = { updatedAt: new Date().toISOString() };
  for (const k of PROFILE_KEYS) (v as Record<string, unknown>)[k] = (m as unknown as Record<string, unknown>)[k] ?? (k === 'status' ? '' : null);
  if (home) v.home = home;
  const clean = JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
  for (const k of Object.keys(clean)) if (clean[k] === null) delete clean[k];
  if (isLocal) {
    cache = { ...cache, [email]: { ...cache[email], ...clean } };
    try {
      localStorage.setItem(LS, JSON.stringify(cache));
    } catch {
      /* 무시 */
    }
    emit();
    return;
  }
  try {
    await setDoc(doc(db, 'profiles', email), clean, { merge: true });
  } catch {
    /* 권한이 없으면 (남의 카드 · 관리자 아님) 카드에만 저장 */
  }
}
/** 관리자 모으기용: 한 사람 정보 통째로 */
export async function writeProfile(email: string, p: Profile) {
  const clean = JSON.parse(JSON.stringify({ ...p, updatedAt: new Date().toISOString() })) as Profile;
  if (isLocal) {
    cache = { ...cache, [low(email)]: clean };
    localStorage.setItem(LS, JSON.stringify(cache));
    emit();
    return;
  }
  await setDoc(doc(db, 'profiles', low(email)), clean);
}
