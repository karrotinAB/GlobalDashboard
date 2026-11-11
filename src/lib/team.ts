// 조(1조·2조·3조) 나누기
//  - 조마다 데이터가 따로: 2조는 원래 컬렉션 이름(members, companies …), 다른 조는 앞에 't1_' 't3_' …
//  - 무역사무 요청(requests)·무역사무 담당자(tradeMembers)는 모든 조가 같이 씀
//  - 계정의 조: roles/{이메일}.team (없으면 2조). 관리자는 위쪽에서 다른 조를 골라 볼 수 있음
import type { CollectionName } from '../types';

export const TEAMS = ['1', '2', '3'] as const;
export const DEFAULT_TEAM = '2';
export const teamLabel = (t?: string) => `${t ?? DEFAULT_TEAM}조`;

/** 조마다 따로인 컬렉션 */
export const TEAM_SCOPED: CollectionName[] = ['members', 'companies', 'tasks', 'orders', 'attendance', 'config', 'claims'];

/** 실제 Firestore 컬렉션 이름 */
export const physName = (col: CollectionName, team: string) =>
  team === DEFAULT_TEAM || !TEAM_SCOPED.includes(col) ? col : `t${team}_${col}`;

const VIEW_KEY = 'gd:viewTeam';
/** 관리자(또는 로컬 모드)가 골라 보는 조 */
export function savedViewTeam(): string | undefined {
  try {
    const t = localStorage.getItem(VIEW_KEY);
    return t && (TEAMS as readonly string[]).includes(t) ? t : undefined;
  } catch {
    return undefined;
  }
}
export function setViewTeam(t: string) {
  try {
    localStorage.setItem(VIEW_KEY, t);
  } catch {
    /* 무시 */
  }
  window.location.hash = '/home';
  window.location.reload();
}
