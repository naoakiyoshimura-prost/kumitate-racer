// node でゲームのモジュールを読むための最小の代用品（ブラウザの location / localStorage / sessionStorage）
const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const g = globalThis as Record<string, unknown>;
g.location ??= { search: '', href: 'http://localhost/', pathname: '/' };
g.localStorage ??= store();
g.sessionStorage ??= store();
