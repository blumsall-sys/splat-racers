import {defineConfig} from 'vite';
import {resolve} from 'node:path';
const repo=(process.env.GITHUB_REPOSITORY||'').split('/')[1];
const base=process.env.SPLAT_BASE|| (repo?`/${repo}/`:'/');
export default defineConfig({base,server:{host:'0.0.0.0',port:5173,strictPort:true},build:{target:'es2022',outDir:'dist',rollupOptions:{input:{main:resolve('index.html'),drivingLab:resolve('DRIVE_LAB.html'),sogInspector:resolve('SOG_TEST.html'),lan:resolve('LAN.html')}}}});
