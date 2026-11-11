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

/** 개인 공간 (팀장님·이사님 계정마다 하나, 'p' + 영문·숫자) */
export const isPersonal = (space?: string) => !!space && /^p[a-z0-9]+$/.test(space);
export const newPersonalSpace = () => 'p' + Math.random().toString(36).slice(2, 10);

/** 실제 Firestore 컬렉션 이름: 2조 = 그대로, 1조 = t1_…, 개인 공간 = p…_… */
export const physName = (col: CollectionName, team: string) =>
  team === DEFAULT_TEAM || !TEAM_SCOPED.includes(col) ? col : isPersonal(team) ? `${team}_${col}` : `t${team}_${col}`;

/** 화면에 보일 이름: '1조' 또는 개인 공간 이름 ('팀장님' …) */
export const spaceLabel = (space: string, personalName?: string) => (isPersonal(space) ? personalName || '내' : `${space}조`);

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
