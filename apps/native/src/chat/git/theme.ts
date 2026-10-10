import type { GitArea } from '../../../../../shared/remote-chat/gitFiles';
import type { ThemeColor, ThemeColorRole } from '../../../../../shared/theme/mode';

const areaRoles: Record<GitArea['id'], ThemeColorRole> = {
  conflict: 'danger', unstaged: 'info', staged: 'accent', mixed: 'purple', untracked: 'warning',
};
const areaBackgrounds: Record<GitArea['id'], ThemeColorRole> = {
  conflict: 'dangerSoft', unstaged: 'infoSoft', staged: 'accentSoft', mixed: 'purpleSoft', untracked: 'warningSoft',
};

export function gitAreaColors(area: GitArea, color: ThemeColor) {
  return { color: color(area.color, areaRoles[area.id]),
    background: color(area.background, areaBackgrounds[area.id]) };
}
