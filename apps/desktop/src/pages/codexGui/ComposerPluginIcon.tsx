import { Blocks, FileText, Globe, LayoutTemplate, Presentation, Sheet } from "lucide-react";
import { ComposerCatalogIcon } from "../../../../../shared/conversation/ComposerCatalogIcon";
import type { ComposerPlugin } from "../../../../../shared/conversation/attachmentTypes";

const ICONS = [
  { match: /document/i, Icon: FileText, color: "#428bea" },
  { match: /pdf/i, Icon: FileText, color: "#db6279" },
  { match: /spreadsheet/i, Icon: Sheet, color: "#599467" },
  { match: /presentation/i, Icon: Presentation, color: "#d7ad52" },
  { match: /template/i, Icon: LayoutTemplate, color: "#50a2d7" },
  { match: /browser/i, Icon: Globe, color: "#439cea" },
];

export function ComposerPluginIcon({ plugin }: { plugin: ComposerPlugin }) {
  const { Icon, color } = ICONS.find((entry) => entry.match.test(plugin.name)) ?? { Icon: Blocks, color: "#579aaa" };
  return <ComposerCatalogIcon urls={[plugin.iconUrl, plugin.interface?.composerIconUrl, plugin.interface?.logoUrl]}
    size={19} fallback={<Icon size={19} style={{ color }} aria-hidden="true" />} />;
}
