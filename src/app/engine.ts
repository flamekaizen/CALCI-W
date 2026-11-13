/** App-wide calculator instance kept in sync with user preferences and library. */
import { Calculator } from '../core/index';
import { useStore } from './store';

let calc: Calculator | null = null;
let libErrors: { line: number; error: string }[] = [];
let lastLibrary = '';

export function getCalculator(): Calculator {
  if (!calc) {
    const s = useStore.getState();
    calc = new Calculator({ ...s.calc });
    lastLibrary = s.library;
    libErrors = calc.loadLibrary(s.library);
    useStore.subscribe((st, prev) => {
      if (st.calc !== prev.calc) calc!.configure({ ...st.calc });
      if (st.library !== lastLibrary) {
        lastLibrary = st.library;
        libErrors = calc!.loadLibrary(st.library);
      }
    });
  }
  return calc;
}

export function libraryErrors() {
  getCalculator();
  return libErrors;
}

/** Library definitions as lines, for graphing / 3D (only `name(args) = …` and `name = …`). */
export function libraryLines(): string[] {
  return useStore
    .getState()
    .library.split(/\r?\n/)
    .map((l) => l.replace(/(#|\/\/).*$/, '').trim())
    .filter((l) => /^[A-Za-z_]\w*\s*(\([^)]*\))?\s*=/.test(l));
}
