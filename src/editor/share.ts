import type { Layout } from './types';

// コースの共有コード: コースの中身（JSON）を縮めて、URL でも壊れない文字（A-Z a-z 0-9 - _）にした文字列。
// 先頭の印: KR1z = 圧縮あり（ブラウザの CompressionStream）、KR1j = 圧縮なし（古いブラウザ用）。
// サーバーには何も送らない。LINE などで文字として送ってもらい、受け取った側が貼り付けて読み込む
const PAT = /KR1([zj])([A-Za-z0-9_-]+)/;

const toB64 = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const u8 = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  return u8;
};
async function pipe(data: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Blob([data]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeCourse(l: Layout): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(l));
  try {
    if (typeof CompressionStream === 'function') return 'KR1z' + toB64(await pipe(json, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>));
  } catch { /* 圧縮できなければ下へ */ }
  return 'KR1j' + toB64(json);
}

// 貼り付けた文（前後に説明の文が付いていてもよい）から共有コードを取り出して、コースの JSON に戻す。読めなければ例外
export async function decodeCourse(text: string): Promise<unknown> {
  const m = PAT.exec(text.replace(/\s+/g, ''));
  if (!m) throw new Error('共有コード（KR1 で始まる文字）が見つかりません');
  let bytes = fromB64(m[2]);
  if (m[1] === 'z') {
    if (typeof DecompressionStream !== 'function') throw new Error('このブラウザは圧縮された共有コードを読めません。ブラウザを新しくしてください');
    bytes = await pipe(bytes, new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// 送るときの文面（コードの前後に、受け取った人向けの説明を付ける）
export const shareText = (l: Layout, code: string) =>
  `組立てレーサーのコース「${l.name}」（${l.lanes}レーン・${l.pieces.length}個）\n共有コード:\n${code}\n\n読み込み方: コースエディタのメニュー →「共有コードを読み込む」に、この文をそのまま貼り付け`;
