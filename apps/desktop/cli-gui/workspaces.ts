import { mkdir, mkdtemp, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Scratch directories persist with the CLI session, without becoming visible projects. */
export class CliWorkspaces {
  private root: string;
  constructor(runtimeRoot: string) { this.root = join(runtimeRoot, 'workspaces'); }

  async directory(cwd?: string, separate = false): Promise<string> {
    if (cwd?.trim()) {
      if (!isAbsolute(cwd) || !await stat(cwd).then(value => value.isDirectory(), () => false)) {
        throw new Error('client.cliGui.invalidRequest');
      }
      return cwd;
    }
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root);
    return separate ? mkdtemp(join(root, 'chat-')) : root;
  }

  async display(cwd: string): Promise<string> {
    // Canonicalize only the app-owned root, preserving explicit project paths and missing history paths.
    const root = await realpath(this.root).catch(() => this.root);
    const child = relative(root, cwd);
    const managed = child === '' || child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
    return managed ? '' : cwd;
  }
}
