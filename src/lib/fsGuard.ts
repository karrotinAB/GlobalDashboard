// Firestore 가드: 앱의 모든 'firebase/firestore' 가져오기가 이 파일을 거침 (vite.config.ts alias)
//   · IT 검토용 계정(auditor): 쓰는 모든 문서에 dummyBy = 내 이메일 표시를 붙임
//       → 서버 규칙이 '표시가 붙은 새 문서 / 내가 만든 가짜 문서' 만 허락 (기존 데이터 수정 · 삭제 불가)
//       → 계정을 지우면 서버(removeUser)가 표시가 붙은 문서를 모두 지움
//   · 일반 계정: 가짜 문서(dummyBy)는 읽을 때 숨김 → 실제 화면에 안 섞임 (IT 검토용 계정끼리는 서로 보임)
/* eslint-disable @typescript-eslint/no-explicit-any */
export * from '@firebase/firestore';
import * as F from '@firebase/firestore';

let dummyBy: string | null = null; // 검토용 계정이면 그 이메일
let viewer = ''; // 지금 로그인한 사람 (자기 가짜 문서는 보여야 하니까)
export function setFsGuard(email: string, auditor: boolean) {
  viewer = (email ?? '').toLowerCase();
  dummyBy = auditor ? viewer : null;
}
export const isAuditorSession = () => !!dummyBy;

const tag = (d: any) => (dummyBy && d && typeof d === 'object' && !Array.isArray(d) ? { ...d, dummyBy } : d);
function watch<T>(p: Promise<T>): Promise<T> {
  return p.catch((e) => {
    if (dummyBy && /permission/i.test(String(e?.code ?? e?.message ?? ''))) window.dispatchEvent(new CustomEvent('gd-guard-denied'));
    throw e;
  });
}

// ---- 쓰기 ----
export function setDoc(ref: any, data: any, opts?: any): Promise<void> {
  return watch(opts === undefined ? F.setDoc(ref, tag(data)) : F.setDoc(ref, tag(data), opts));
}
export function addDoc(ref: any, data: any): Promise<any> {
  return watch(F.addDoc(ref, tag(data)));
}
export function updateDoc(ref: any, ...args: any[]): Promise<void> {
  if (dummyBy) {
    if (args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof F.FieldPath)) args = [tag(args[0])];
    else args = [...args, 'dummyBy', dummyBy];
  }
  return watch((F.updateDoc as any)(ref, ...args));
}
export function deleteDoc(ref: any): Promise<void> {
  return watch(F.deleteDoc(ref));
}
export function writeBatch(db: any): any {
  const b: any = F.writeBatch(db);
  if (!dummyBy) return b;
  const set = b.set.bind(b), update = b.update.bind(b), commit = b.commit.bind(b);
  b.set = (ref: any, data: any, opts?: any) => (opts === undefined ? set(ref, tag(data)) : set(ref, tag(data), opts));
  b.update = (ref: any, ...args: any[]) =>
    args.length === 1 && args[0] && typeof args[0] === 'object' && !(args[0] instanceof F.FieldPath) ? update(ref, tag(args[0])) : update(ref, ...args, 'dummyBy', dummyBy);
  b.commit = () => watch(commit());
  return b;
}

// ---- 읽기: 다른 사람의 가짜 문서 숨기기 ----
const hiddenDoc = (d: any) => {
  if (dummyBy) return false; // IT 검토용 계정끼리는 서로의 가짜 데이터도 봄 (IT팀 대시보드를 같이 씀)
  try {
    const by = d?.get?.('dummyBy');
    return !!by && by !== viewer;
  } catch {
    return false;
  }
};
const bindGet = (t: any, k: PropertyKey) => {
  const v = Reflect.get(t, k, t);
  return typeof v === 'function' ? v.bind(t) : v;
};
function wrapQuery(s: any): any {
  const docs = s.docs as any[];
  if (!docs.some(hiddenDoc)) return s;
  const keep = docs.filter((d) => !hiddenDoc(d));
  return new Proxy(s, {
    get(t, k) {
      if (k === 'docs') return keep;
      if (k === 'size') return keep.length;
      if (k === 'empty') return keep.length === 0;
      if (k === 'forEach') return (cb: any, thisArg?: any) => keep.forEach(cb, thisArg);
      if (k === 'docChanges') return (o?: any) => t.docChanges(o).filter((c: any) => !hiddenDoc(c.doc));
      return bindGet(t, k);
    },
  });
}
function wrapDoc(s: any): any {
  if (!s?.exists?.() || !hiddenDoc(s)) return s;
  return new Proxy(s, {
    get(t, k) {
      if (k === 'exists') return () => false;
      if (k === 'data' || k === 'get') return () => undefined;
      return bindGet(t, k);
    },
  });
}
const wrapSnap = (s: any) => (s && 'docs' in s ? wrapQuery(s) : wrapDoc(s));

export function onSnapshot(ref: any, ...args: any[]): any {
  let done = false;
  const mapped = args.map((a) => {
    if (!done && typeof a === 'function') {
      done = true;
      return (s: any) => a(wrapSnap(s));
    }
    if (!done && a && typeof a === 'object' && typeof a.next === 'function') {
      done = true;
      return { ...a, next: (s: any) => a.next(wrapSnap(s)) };
    }
    return a;
  });
  return (F.onSnapshot as any)(ref, ...mapped);
}
export async function getDocs(q: any): Promise<any> {
  return wrapQuery(await F.getDocs(q));
}
export async function getDoc(ref: any): Promise<any> {
  return wrapDoc(await F.getDoc(ref));
}
