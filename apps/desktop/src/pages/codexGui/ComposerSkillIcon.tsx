import { Box } from "lucide-react";
import { ComposerCatalogIcon } from "../../../../../shared/conversation/ComposerCatalogIcon";
import type { Skill } from "../../../../../shared/conversation/types";

export function ComposerSkillIcon({ skill, size = 18 }: { skill: Skill; size?: number }) {
  return <ComposerCatalogIcon urls={[skill.iconUrl, skill.interface?.iconSmallUrl, skill.interface?.iconLargeUrl]}
    size={size} fallback={<Box size={size} aria-hidden="true" />} />;
}
