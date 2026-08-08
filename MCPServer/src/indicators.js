import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Indicators as IndicatorsCore } from './indicators-core.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'indicators.json');

/** Node flavour: same class, plus reading the file from disk. */
export class Indicators extends IndicatorsCore {
  async load() {
    return this.loadFrom(JSON.parse(await readFile(FILE, 'utf8')));
  }
}
