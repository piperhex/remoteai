import { uiText } from "../../../../../shared/localization/uiText";
import { ComposerSkillIcon } from "./ComposerSkillIcon";
import { skillDescription, skillLabel } from "./skillEditorDom";
import type { Skill } from "../../../../../shared/conversation/types";
import styles from "./ComposerAddMenu.module.less";

export function ComposerSkillSection({ catalog, onChoose }: {
  catalog: { skills: Skill[]; loading: boolean; error: string }; onChoose: (skill: Skill) => void;
}) {
  return <>
    <div className={styles.heading}>{uiText("client.chat.skills")}</div>
    {catalog.skills.map((skill) => <button type="button" role="menuitem" key={skill.path}
      disabled={!skill.enabled} className={styles.option} onClick={() => onChoose(skill)}>
      <ComposerSkillIcon skill={skill} size={19} />
      <span>{skillLabel(skill)}{!skill.enabled && uiText("client.chat.disabled")}<small>{skillDescription(skill)}</small></span>
    </button>)}
    {catalog.loading && <p role="status" className={styles.empty}>{uiText("client.chat.loadingSkills")}</p>}
    {catalog.error && <p role="status" className={styles.empty}>{catalog.error}</p>}
    {!catalog.loading && !catalog.error && !catalog.skills.length
      && <p className={styles.empty}>{uiText("client.composer.noSkillsAvailable")}</p>}
  </>;
}
