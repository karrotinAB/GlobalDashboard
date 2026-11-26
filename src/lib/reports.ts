// 보고방: 각 조원이 쓰는 보고 → 그 조 · 팀장님 · 이사님이 봄. 팀장님·이사님은 확인 체크 + 답변
//   reports/{id}: { team, title, body, authorEmail, authorName, createdAt, checks: { lead?, director? }, replies: [] }
import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';
import type { RequestFile } from '../types';

/** 보고에 붙이는 사진·파일 (reports/{보고id}/…) — 로컬 모드는 1.5MB 까지 브라우저에 */
export async function uploadReportFile(reportId: string, file: File): Promise<RequestFile> {
  if (DATA_MODE === 'local') {
    if (file.size > 1.5 * 1024 * 1024) throw new Error('로컬 모드에서는 1.5MB 이하만 넣을 수 있어요');
    const url = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
    return { name: file.name, url };
  }
  const name = file.name || `사진-${Date.now()}.png`;
  const path = `reports/${reportId}/${Date.now()}-${name.replace(/[^\w.\-가-힣]/g, '_')}`;
  const r = storageRef(storage, path);
  // 사진이 아닌 파일은 누르면 열리지 않고 바로 내려받아지게 (원래 파일 이름으로)
  const image = (file.type || '').startsWith('image/');
  await uploadBytes(r, file, image ? undefined : { contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
  return { name, url: await getDownloadURL(r), path };
}

/** 파일 내려받기: 원래 이름으로 저장 (안 되면 새 창으로 열기) */
export async function downloadFile(f: RequestFile) {
  try {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch {
    // 저장소가 바로 받기를 막으면: PDF 는 새 창, 엑셀·워드 등은 이 창에서 받기 (브라우저가 내려받음)
    if (/\.pdf$/i.test(f.name)) window.open(f.url, '_blank', 'noopener');
    else {
      const a = document.createElement('a');
      a.href = f.url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }
}

export type CheckRole = 'lead' | 'director';
export interface ReportCheck {
  by: string; // 이름
  email?: string;
  at: string; // ISO
}
export interface ReportReply {
  id: string;
  name: string;
  email?: string;
  role?: string; // 'lead' | 'director' | 'member' | 'admin'
  text: string;
  at: string;
  parentId?: string; // 대댓글: 어느 답글에 단 것인지
  ack?: { at: string; by?: string }; // (예전) 👍 담당 확인 — 지금은 reactions 로
  reactions?: Record<string, { email?: string; name: string; at: string }[]>; // 이모지 → 누른 사람들
}
export const REACTIONS = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
export interface Report {
  id: string;
  team: string; // '1' | '2' | '3'
  title: string;
  body: string;
  authorEmail?: string;
  authorName?: string;
  createdAt: string;
  updatedAt?: string;
  checks?: Partial<Record<CheckRole, ReportCheck>>;
  to?: CheckRole[]; // 확인자 (팀장님 · 이사님). 없으면 둘 다 (예전 보고)
  edits?: number; // 고친 횟수
  retask?: CheckRole[]; // 첫 번째 고치기에서 확인자로 (다시) 넣은 분 → 주간 할일에 다시 넣음
  replies?: ReportReply[];
  files?: RequestFile[]; // 사진 · 파일
  sharePeople?: string[]; // 공유: 같이 보게 추가한 다른 조 · 무역사무 사람 (이메일) — 그 사람에게 알림
  shareTeams?: string[]; // 공유받은 조 ('1'·'2'·'3'·'trade') — 그 조 보고방에도 보임
}

export const CHECK_LABEL: Record<CheckRole, string> = { lead: '팀장님', director: '이사님' };
export const isLeaderRole = (r?: string | null): r is CheckRole => r === 'lead' || r === 'director';
/** 이 보고의 확인자인가 (to 가 없으면 둘 다) */
export const needsCheck = (r: { to?: CheckRole[] }, k: CheckRole) => !r.to || r.to.includes(k);

const LOCAL_KEY = 'gd:reports';
const readLocal = (): Report[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as Report[];
  } catch {
    return [];
  }
};
const writeLocal = (list: Report[]) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event('gd-reports'));
};

/** 보고 목록. team 을 주면 그 조만 (조원은 자기 조만 읽을 수 있음), null 이면 모든 조 (팀장님·이사님·관리자) */
export function useReports(team: string | null | undefined) {
  const [list, setList] = useState<Report[] | null>(null);
  useEffect(() => {
    if (team === undefined) return setList([]); // 안 불러옴
    if (DATA_MODE === 'local') {
      const load = () => setList(readLocal().filter((r) => !team || r.team === team || (r.shareTeams ?? []).includes(team)));
      load();
      window.addEventListener('gd-reports', load);
      return () => window.removeEventListener('gd-reports', load);
    }
    setList(null);
    if (!team)
      return onSnapshot(
        collection(db, 'reports'),
        (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<Report, 'id'>), id: d.id }))),
        () => setList([]),
      );
    // 우리 조 보고 + 다른 조가 우리 조에 공유한 보고
    let own: Report[] | null = null;
    let shared: Report[] = [];
    const emit = () => own && setList([...own, ...shared.filter((x) => !own!.some((y) => y.id === x.id))]);
    const u1 = onSnapshot(
      query(collection(db, 'reports'), where('team', '==', team)),
      (snap) => {
        own = snap.docs.map((d) => ({ ...(d.data() as Omit<Report, 'id'>), id: d.id }));
        emit();
      },
      () => setList([]),
    );
    const u2 = onSnapshot(
      query(collection(db, 'reports'), where('shareTeams', 'array-contains', team)),
      (snap) => {
        shared = snap.docs.map((d) => ({ ...(d.data() as Omit<Report, 'id'>), id: d.id }));
        emit();
      },
      () => {},
    );
    return () => {
      u1();
      u2();
    };
  }, [team]);
  return list ? [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : null;
}

/** 저장 (통째로) */
export async function saveReport(r: Report) {
  const clean = JSON.parse(JSON.stringify(r)) as Report; // undefined 빼기
  if (DATA_MODE === 'local') {
    const list = readLocal().filter((x) => x.id !== r.id);
    writeLocal([...list, clean]);
    return;
  }
  const { id, ...rest } = clean;
  await setDoc(doc(db, 'reports', id), rest);
}

export async function deleteReport(id: string) {
  if (DATA_MODE === 'local') return writeLocal(readLocal().filter((x) => x.id !== id));
  await deleteDoc(doc(db, 'reports', id));
}

/** 이 보고에 내가 아직 안 본 팀장님·이사님 답변이 있나 (조원 쪽 알림) */
const seenKey = (id: string) => `gd:reportSeen:${id}`;
/** 알림이 될 일: 팀장님·이사님(·관리자) 답변, 팀장님·이사님 확인 체크 — 내가 한 건 빼고 */
export const lastLeaderEvent = (r: Report, myEmail?: string) => {
  const me = (myEmail ?? '').toLowerCase();
  const notMe = (e?: string) => !me || (e ?? '').toLowerCase() !== me;
  const replies = (r.replies ?? []).filter((x) => (isLeaderRole(x.role) || x.role === 'admin') && notMe(x.email)).map((x) => x.at);
  const checks = Object.values(r.checks ?? {})
    .filter((c): c is ReportCheck => !!c && notMe(c.email))
    .map((c) => c.at);
  return [...replies, ...checks].sort().pop();
};
/** 내 답글에 다른 사람이 단 대댓글 (가장 최근 시각) */
export const lastReplyToMe = (r: Report, myEmail?: string) => {
  const me = (myEmail ?? '').toLowerCase();
  if (!me) return undefined;
  const mine = new Set((r.replies ?? []).filter((x) => (x.email ?? '').toLowerCase() === me).map((x) => x.id));
  return (r.replies ?? [])
    .filter((x) => x.parentId && mine.has(x.parentId) && (x.email ?? '').toLowerCase() !== me)
    .map((x) => x.at)
    .sort()
    .pop();
};
/** 이 보고를 열기 전에 마지막으로 본 때 (열면서 바뀌기 전 값 — 새 대댓글 점 표시용) */
export const seenBefore = (id: string) => {
  try {
    return localStorage.getItem(`gd:reportSeenPrev:${id}`) ?? '';
  } catch {
    return '';
  }
};
export function isUnseen(r: Report, myEmail?: string) {
  const last = [lastLeaderEvent(r, myEmail) ?? '', lastReplyToMe(r, myEmail) ?? ''].sort().pop();
  if (!last) return false;
  try {
    return (localStorage.getItem(seenKey(r.id)) ?? '') < last;
  } catch {
    return false;
  }
}
export function markSeen(r: Report) {
  try {
    localStorage.setItem(`gd:reportSeenPrev:${r.id}`, localStorage.getItem(seenKey(r.id)) ?? '');
    localStorage.setItem(seenKey(r.id), new Date().toISOString());
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event('gd-reports-seen'));
}

/** 팀장님·이사님 쪽 알림: 내가 확인자인 보고가 새로 올라왔거나 다른 사람이 답글을 달았는데 아직 안 열어 본 것 */
export function isUnseenLeader(r: Report, role: CheckRole, myEmail?: string) {
  // 확인자가 아니어도 내 답글에 대댓글이 달리면 알림
  if (!needsCheck(r, role)) return isUnseen({ ...r, checks: {}, replies: (r.replies ?? []).filter((x) => x.parentId) }, myEmail);
  const me = (myEmail ?? '').toLowerCase();
  const last = [r.createdAt, r.updatedAt ?? '', ...(r.replies ?? []).filter((x) => (x.email ?? '').toLowerCase() !== me).map((x) => x.at)].sort().pop() ?? '';
  // 이미 확인 체크한 보고는 그 뒤에 생긴 것만
  const checked = r.checks?.[role]?.at ?? '';
  try {
    const seen = localStorage.getItem(seenKey(r.id)) ?? '';
    return (seen > checked ? seen : checked) < last;
  } catch {
    return checked < last;
  }
}

/** 탭 위 빨간 점: (조) 내 조 보고에 안 본 팀장님·이사님 답변·확인 / (팀장님·이사님 leaderRole) 새 보고·답글 */
export function useReportAlert(team: string | null, enabled: boolean, myEmail?: string, leaderRole?: CheckRole | null) {
  const list = useReports(enabled ? team : undefined);
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((x) => x + 1);
    window.addEventListener('gd-reports-seen', h);
    return () => window.removeEventListener('gd-reports-seen', h);
  }, []);
  return enabled && !!list?.some((r) => (leaderRole ? isUnseenLeader(r, leaderRole, myEmail) : isUnseen(r, myEmail)));
}

/** 보고 하나의 확인 체크 켜기/끄기 (주간 할일의 '보고 확인하기' 체크에서) */
export async function setReportCheck(id: string, k: CheckRole, on: boolean, by: string, email?: string) {
  if (DATA_MODE === 'local') {
    const list = readLocal();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    const checks = { ...(r.checks ?? {}) };
    if (on) checks[k] = { by, email, at: new Date().toISOString() };
    else delete checks[k];
    writeLocal(list.map((x) => (x.id === id ? { ...x, checks } : x)));
    return;
  }
  const { updateDoc, deleteField } = await import('firebase/firestore');
  await updateDoc(doc(db, 'reports', id), { [`checks.${k}`]: on ? JSON.parse(JSON.stringify({ by, email, at: new Date().toISOString() })) : deleteField() });
}

/** 지금 보는 개인 대시보드의 '확인 칸': 본인(팀장님·이사님)이면 내 칸, 관리자가 그 대시보드를 보면 주인의 칸 */
export function useSpaceCheckRole(role: string | null, viewTeam: string, roles: { role: string; space?: string }[] | null): CheckRole | null {
  if (isLeaderRole(role)) return role;
  if (role !== 'admin' || !roles) return null;
  const owner = roles.find((r) => r.space === viewTeam)?.role;
  return isLeaderRole(owner) ? owner : null;
}
