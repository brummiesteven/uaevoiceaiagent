import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LivingInfo as LivingInfoCore } from './living-core.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'living-in-dubai.json');

/** Node flavour: same class, plus reading the file from disk. */
export class LivingInfo extends LivingInfoCore {
  async load() {
    return this.loadFrom(JSON.parse(await readFile(FILE, 'utf8')));
  }
}
