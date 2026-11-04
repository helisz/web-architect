import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ArchitectureDiagram } from '../src/types.js';

/** 全阶段回归基线：按规格 §10.5 复刻的标准样图 */
export const SAMPLE_PATH = fileURLToPath(new URL('../fixtures/sample-saas.json', import.meta.url));

export function loadSample(): ArchitectureDiagram {
  return JSON.parse(readFileSync(SAMPLE_PATH, 'utf8')) as ArchitectureDiagram;
}

export const sample = loadSample();
