/// <reference types="vite/client" />

// Injected by vite.config.ts at build time (the build stamp).
declare const __BUILD_ID__: string;
declare const __BUILD_CHANNEL__: 'prod' | 'staging' | 'dev';
declare const __BUILD_BRANCH__: string;
// The sim chunk's code hash, written over a placeholder after bundling (scripts/sim-chunk.mjs).
declare const __SIM_CODE_HASH__: string;
