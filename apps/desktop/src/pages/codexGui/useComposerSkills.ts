import { uiText } from "../../../../../shared/localization/uiText";
import { useContext, useEffect, useState } from "react";
import { MessageEditContext } from './messageEditContext';
import { guiApi } from "../../../../../shared/conversation/api";
import { skillLabel } from "./skillEditorDom";
import type { Skill, SkillsResponse } from "../../../../../shared/conversation/types";

export function useComposerSkills({ cwd, active, connected }: {
  cwd: string; active: boolean; connected: boolean;
}) {
  const { loadSkills } = useContext(MessageEditContext);
  const [result, setResult] = useState({ cwd: "", skills: [] as Skill[], loading: false, error: "" });
  useEffect(() => {
    if (!active || !connected) return;
    let cancelled = false;
    setResult({ cwd, skills: [], loading: true, error: "" });
    const request = loadSkills ? loadSkills(cwd)
      : guiApi.request<SkillsResponse>({ operation: "skills", cwd: cwd || undefined });
    void request.then((response) => {
      if (cancelled) return;
      const skills = [...new Map(response.data.flatMap((entry) => entry.skills)
        .map((skill) => [skill.path, skill])).values()]
        .sort((left, right) => skillLabel(left).localeCompare(skillLabel(right)));
      const error = response.data.some((entry) => entry.errors.length)
        ? uiText("client.workspaceActions.someSkillsCouldNotLoadReopenTheMenuToRetry") : "";
      setResult({ cwd, skills, loading: false, error });
    }).catch(() => {
      if (!cancelled) setResult({ cwd, skills: [], loading: false, error: uiText("client.workspaceActions.couldNotLoadSkillsReopenTheMenuToRetry") });
    });
    return () => { cancelled = true; };
  }, [cwd, active, connected, loadSkills]);
  return result.cwd === cwd ? result : { skills: [], loading: active, error: "" };
}
