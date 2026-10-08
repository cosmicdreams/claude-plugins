import { isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';

/** The person's runner token file, inside designLabHome(). Never printed. */
export const TOKEN_FILE = 'runner-token';
/** The person's design-lab folder: DESIGN_LAB_HOME when set (absolute), else ~/.design-lab. Every reader, writer and message that names the token uses this. */
export const designLabHome = (): string => {
  const home = process.env['DESIGN_LAB_HOME'];
  if (home && !isAbsolute(home))
    throw new Error('DESIGN_LAB_HOME must be an absolute path (for example /tmp/design-lab-home)');
  return home || resolve(homedir(), '.design-lab');
};
