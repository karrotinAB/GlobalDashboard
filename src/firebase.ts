import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

// 웹 앱 설정값: 브라우저에 그대로 내려가는 공개용 값 (보안은 firestore.rules + 로그인으로 지킴)
export const firebaseConfig = {
  apiKey: 'AIzaSyDSM1YEHCyjuEfhKH3NY-_i1ppDoHo-QOQ',
  authDomain: 'global-dash-1d62d.firebaseapp.com',
  projectId: 'global-dash-1d62d',
  storageBucket: 'global-dash-1d62d.firebasestorage.app',
  messagingSenderId: '231493716635',
  appId: '1:231493716635:web:b3eb3695cb10dbdd3ad43e',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// 오프라인 캐시: 새로고침해도 읽기 횟수를 아끼고, 여러 탭에서 같이 씀
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
