import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { useResolvedTheme } from '../ui';

export function Editor({ value, onChange, lang, onRun, ariaLabel = 'Code editor' }: { value: string; onChange: (v: string) => void; lang: 'js' | 'python' | 'plain'; onRun?: () => void; ariaLabel?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const themeComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  const theme = useResolvedTheme();

  useEffect(() => {
    if (!host.current) return;
    const langExt = lang === 'js' ? javascript() : lang === 'python' ? python() : [];
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([{ key: 'Mod-Enter', run: () => (onRunRef.current?.(), true) }]),
          langComp.current.of(langExt),
          themeComp.current.of(theme === 'dark' ? oneDark : []),
          EditorView.updateListener.of((u) => u.docChanged && onChangeRef.current(u.state.doc.toString())),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          EditorView.lineWrapping,
        ],
      }),
    });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: langComp.current.reconfigure(lang === 'js' ? javascript() : lang === 'python' ? python() : []) });
  }, [lang]);

  useEffect(() => {
    view.current?.dispatch({ effects: themeComp.current.reconfigure(theme === 'dark' ? oneDark : []) });
  }, [theme]);

  return <div ref={host} className="editor-wrap" />;
}
