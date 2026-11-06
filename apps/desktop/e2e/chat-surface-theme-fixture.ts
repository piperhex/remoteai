import type { Skill } from '../../../shared/conversation/types';

export const surfaceSkills: Skill[] = [
  { name: 'code-review', path: '/skills/code-review', description: '检查代码质量并提出改进建议。', enabled: true },
  { name: 'design-review', path: '/skills/design-review', description: '检查界面布局、视觉层级和交互反馈。', enabled: true },
  { name: 'disabled-skill', path: '/skills/disabled', description: '当前不可用的技能。', enabled: false },
];
export const surfaceDevices = [
  { deviceId: 'office', name: 'Office PC', platform: 'windows', online: true },
  { deviceId: 'home', name: 'Home PC', platform: 'macos', online: true },
  { deviceId: 'offline', name: 'Offline PC', platform: 'linux', online: false },
];
export const loadSurfaceSkills = async () => ({ data: [{ skills: surfaceSkills, errors: [] }] });
