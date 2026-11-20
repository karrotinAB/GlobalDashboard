// 휴대폰 알림 (웹 푸시 · Firebase Cloud Messaging)
//   켜면 이 기기의 알림 주소(토큰)를 pushTokens/{토큰} = { email, at, ua } 에 저장 → 서버가 보고방 · 전도금 마감 알림을 보냄
//   안드로이드: 크롬 · 설치한 앱 / 아이폰: 홈 화면에 설치한 앱만 (iOS 16.4+)
import { useEffect, useState } from 'react';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app, db } from '../firebase';

/** Firebase 콘솔 › 프로젝트 설정 › 클라우드 메시징 › 웹 푸시 인증서의 '키 쌍' (공개 키 · 사이트에 넣어도 되는 값) */
export const VAPID_KEY = '';

const LS = 'gd:pushToken';
export type PushState = 'unsupported' | 'not-ready' | 'blocked' | 'off' | 'on';

const isIosNotInstalled = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone);

export function usePushState(): [PushState, () => void, string] {
  const [st, setSt] = useState<PushState>('off');
  const [why, setWhy] = useState('');
  const check = () => {
    void (async () => {
      if (!VAPID_KEY) return (setSt('not-ready'), setWhy('관리자가 알림 설정을 마치면 켤 수 있어요'));
      if (isIosNotInstalled()) return (setSt('unsupported'), setWhy("아이폰은 사파리 공유 버튼 › '홈 화면에 추가'로 앱을 설치한 뒤, 그 앱에서 켤 수 있어요"));
      if (!('Notification' in window) || !(await isSupported().catch(() => false))) return (setSt('unsupported'), setWhy('이 브라우저는 알림을 지원하지 않아요 (크롬 · 설치한 앱에서 켜 주세요)'));
      if (Notification.permission === 'denied') return (setSt('blocked'), setWhy('알림이 차단돼 있어요 — 브라우저(앱) 설정 › 알림에서 허용해 주세요'));
      setWhy('');
      setSt(Notification.permission === 'granted' && localStorage.getItem(LS) ? 'on' : 'off');
    })();
  };
  useEffect(check, []);
  return [st, check, why];
}

export async function enablePush(email: string) {
  if (!VAPID_KEY) throw new Error('알림 키가 아직 없어요');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림을 허용해야 받을 수 있어요');
  const reg = (await navigator.serviceWorker.getRegistration('./')) ?? (await navigator.serviceWorker.register('./sw.js'));
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) throw new Error('알림 주소를 받지 못했어요');
  await setDoc(doc(db, 'pushTokens', token), { email: email.toLowerCase(), at: new Date().toISOString(), ua: navigator.userAgent.slice(0, 120) });
  localStorage.setItem(LS, token);
}

export async function disablePush() {
  const token = localStorage.getItem(LS);
  if (token) await deleteDoc(doc(db, 'pushTokens', token)).catch(() => {});
  await deleteToken(getMessaging(app)).catch(() => {});
  localStorage.removeItem(LS);
}
