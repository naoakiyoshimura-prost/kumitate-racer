import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 通常はゲーム(index.html)とボディ工房(builder.html)の2ページ。
// SINGLEFILE=1 で1ファイルHTMLに固める（プレビュー公開用。既定はゲーム、SINGLE_ENTRY=editor.html でエディタ）
export default defineConfig({
  base: './',
  plugins: process.env.SINGLEFILE ? [viteSingleFile()] : [],
  build: process.env.SINGLEFILE ? (process.env.SINGLE_ENTRY ? { rollupOptions: { input: process.env.SINGLE_ENTRY } } : {}) : { rollupOptions: { input: { main: 'index.html', builder: 'builder.html', editor: 'editor.html', kit: 'kit.html' } } },
});
