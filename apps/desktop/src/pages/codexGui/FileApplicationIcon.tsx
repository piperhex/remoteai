import { Code2, FolderOpen, Terminal } from "lucide-react";
import { ComposerCatalogIcon } from "./ComposerCatalogIcon";
import type { FileApplication } from "./fileApi";
import styles from "./FileMenu.module.less";

const FALLBACKS = { editor: Code2, terminal: Terminal, system: FolderOpen };

export function FileApplicationIcon({ application }: { application: FileApplication }) {
  const Fallback = FALLBACKS[application.kind];
  return <ComposerCatalogIcon urls={[application.icon]} size={16} className={styles.applicationIcon}
    fallback={<Fallback size={16} />} />;
}
