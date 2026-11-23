// 페이지를 따로 받아 올 때 (lazy): 사이트를 새로 올리면 예전 파일 이름이 없어져서, 이미 열려 있던 창은
// 다음 페이지를 못 받아 와 화면이 통째로 하얘짐 → 한 번 자동으로 새로고침해서 새 파일을 받음
import { Component, lazy, type ComponentType, type ReactNode } from 'react';

const KEY = 'gd:chunkReload';
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return lazy(async () => {
    try {
      const m = await load();
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* 무시 */
      }
      return m;
    } catch (e) {
      // 10초 안에 또 실패하면 다시 새로고침하지 않고 오류 화면으로 (무한 새로고침 방지)
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(KEY) || 0);
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* 무시 */
      }
      if (Date.now() - last > 10000) {
        window.location.reload();
        return new Promise<{ default: T }>(() => {}); // 새로고침되는 동안 기다림
      }
      throw e;
    }
  });
}

/** 페이지에서 오류가 나도 화면 전체가 하얘지지 않게: 위쪽 메뉴는 그대로, 본문에 안내 + 새로고침 */
export class PageErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null });
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="page">
        <div className="card" style={{ maxWidth: 520 }}>
          <h2>😵 이 화면을 여는 중에 문제가 생겼어요</h2>
          <p className="muted small">사이트가 방금 새로 올라와서 그럴 수 있어요. 새로고침하면 대부분 바로 돼요.</p>
          <p className="muted small" style={{ wordBreak: 'break-all' }}>{this.state.err.message}</p>
          <button className="primary" onClick={() => window.location.reload()}>
            ↻ 새로고침
          </button>
        </div>
      </div>
    );
  }
}
