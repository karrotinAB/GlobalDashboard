// 매장명 (회사 API STORE_NAME): 서버가 storeNames/{STORE_ID} 에 저장 · 없는 매장은 서버에 한 번 물어봄
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { DATA_MODE } from '../data/store';

const asked = new Set<string>(); // 이번에 서버에 물어본 매장 (같은 창에서 또 안 물음)
export function useStoreNames(ids: string[], enabled: boolean): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({});
  const [seen, setSeen] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!enabled || DATA_MODE === 'local') return;
    return onSnapshot(
      collection(db, 'storeNames'),
      (snap) => {
        setMap(Object.fromEntries(snap.docs.map((d) => [d.id, String(d.get('name') ?? '')]).filter(([, n]) => n)));
        setSeen(new Set(snap.docs.map((d) => d.id)));
      },
      () => setSeen(new Set()),
    );
  }, [enabled]);
  const sig = [...new Set(ids)].sort().join(',');
  useEffect(() => {
    if (!enabled || !seen || DATA_MODE === 'local') return;
    const missing = sig.split(',').filter((id) => id && !seen.has(id) && !asked.has(id));
    if (!missing.length) return;
    missing.forEach((id) => asked.add(id));
    void httpsCallable(functions, 'storeNamesLookup')({ ids: missing }).catch(() => {});
  }, [sig, seen, enabled]);
  return map;
}
