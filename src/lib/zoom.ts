// 화면 비율 (컴퓨터에서는 html 을 80% 로 줄여서 보여줌 — styles.css 의 html { zoom })
//   getBoundingClientRect · clientX · innerWidth 는 줄어든 화면 기준이라, 화면 기준 위치(position: fixed)에 쓸 때는 비율로 나눠야 맞음
export const zoomOf = () => {
  if (typeof document === 'undefined') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
};
/** 요소 위치를 CSS 좌표로 (position: fixed 에 바로 씀) */
export const rectOf = (el: Element) => {
  const z = zoomOf();
  const r = el.getBoundingClientRect();
  return { left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
};
/** 선택 영역 · DOMRect 를 CSS 좌표로 */
export const unzoom = (r: DOMRect) => {
  const z = zoomOf();
  return { left: r.left / z, right: r.right / z, top: r.top / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
};
/** 화면 크기 (CSS 좌표) */
export const viewW = () => window.innerWidth / zoomOf();
export const viewH = () => window.innerHeight / zoomOf();
