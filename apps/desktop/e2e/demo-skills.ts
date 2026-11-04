import type { Skill } from '../../../shared/conversation/types';

let revision = 1;
let delay = 0;
let extra = 0;
export function setDemoSkills(input: { revision?: number; delay?: number; extra?: number }) {
  revision = input.revision ?? revision;
  delay = Math.max(0, Math.min(20_000, input.delay ?? delay));
  extra = Math.max(0, Math.min(100, input.extra ?? extra));
}
export const demoSkillsDelay = () => delay;
export function demoSkills() {
  const skills: Skill[] = [
    { name: 'review', path: 'F:/skills/review/SKILL.md', description: '检查代码改动', enabled: true,
      interface: { displayName: revision === 1 ? '代码检查' : '代码检查（已更新）' } },
    { name: 'disabled', path: 'F:/skills/disabled/SKILL.md', description: '暂不可用', enabled: false },
    ...Array.from({ length: extra }, (_, index) => ({ name: `skill-${index}`, enabled: true,
      path: `F:/skills/skill-${index}/SKILL.md`, description: `技能 ${index}：用于检查较长技能列表的滚动和选择。` })),
  ];
  return { data: [{ skills, errors: [] }] };
}
