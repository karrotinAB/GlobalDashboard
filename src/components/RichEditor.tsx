// 게시판처럼 쓰는 글 상자: 굵게·기울임·밑줄·취소선 · 글자색 · 형광펜 · 목록 · 서식 지우기 (업체 메모와 같은 도구)
import { useRef } from 'react';
import { memoHtml, sanitize } from '../lib/richtext';

const COLORS = ['#2b1f1d', '#c0392b', '#d07a17', '#2f7d4a', '#2f63b0', '#7a4bb0'];
const MARKS = ['#fff3a3', '#ffd6d6', '#d6f0d9', '#d6e6ff'];

export default function RichEditor({
  initial,
  onChange,
  placeholder,
  onCtrlEnter,
  minHeight = 220,
}: {
  initial?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onCtrlEnter?: () => void;
  minHeight?: number;
}) {
  const editor = useRef<HTMLDivElement | null>(null);
  const emit = () => {
    const html = sanitize(editor.current?.innerHTML ?? '');
    onChange(html.replace(/<br>|<\/?(div|p)>|&nbsp;|\s/g, '') ? html : '');
  };
  const cmd = (name: string, value?: string) => {
    editor.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(name, false, value);
    emit();
  };
  return (
    <div className="rich-editor">
      <div className="memo-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" title="굵게 (Ctrl+B)" onClick={() => cmd('bold')}>
          <b>B</b>
        </button>
        <button type="button" title="기울임 (Ctrl+I)" onClick={() => cmd('italic')}>
          <i>I</i>
        </button>
        <button type="button" title="밑줄 (Ctrl+U)" onClick={() => cmd('underline')}>
          <u>U</u>
        </button>
        <button type="button" title="취소선" onClick={() => cmd('strikeThrough')}>
          <s>S</s>
        </button>
        <span className="memo-sep" />
        {COLORS.map((c) => (
          <button type="button" key={c} className="memo-color" title="글자색" onClick={() => cmd('foreColor', c)}>
            <span style={{ color: c }}>A</span>
          </button>
        ))}
        <span className="memo-sep" />
        {MARKS.map((c) => (
          <button type="button" key={c} className="memo-color" title="형광펜" onClick={() => cmd('hiliteColor', c)}>
            <span className="memo-mark" style={{ background: c }}>
              가
            </span>
          </button>
        ))}
        <span className="memo-sep" />
        <button type="button" title="목록" onClick={() => cmd('insertUnorderedList')}>
          •≡
        </button>
        <button type="button" title="서식 지우기" onClick={() => cmd('removeFormat')}>
          ⌫ 서식
        </button>
      </div>
      <div
        ref={(el) => {
          editor.current = el;
          if (el && !el.dataset.ready) {
            el.innerHTML = memoHtml(initial);
            el.dataset.ready = '1';
          }
        }}
        className="memo-area memo-rich"
        style={{ minHeight }}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && onCtrlEnter) {
            e.preventDefault();
            onCtrlEnter();
          }
        }}
        onPaste={(e) => {
          // 붙여넣은 사진은 위쪽 파일 칸에서 받음 · 다른 곳 서식은 허용한 것만
          if ([...e.clipboardData.files].some((f) => f.type.startsWith('image/'))) return;
          const html = e.clipboardData.getData('text/html');
          if (!html) return;
          e.preventDefault();
          document.execCommand('insertHTML', false, sanitize(html));
          emit();
        }}
      />
    </div>
  );
}
