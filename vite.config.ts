import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLEFILE=1 で1ファイルHTMLに固める（プレビュー公開用）
export default defineConfig({
  base: './',
  plugins: process.env.SINGLEFILE ? [viteSingleFile()] : [],
});
