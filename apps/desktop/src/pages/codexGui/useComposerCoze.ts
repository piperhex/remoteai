import { displayError } from '../../../../../shared/localization/uiText';
import { useEffect, useState } from "react";
import { guiApi } from "../../../../../shared/conversation/api";


export interface CozeReference { id: string; name: string; kind: string; description: string }

export function useComposerCoze(active: boolean) {
  const [result, setResult] = useState({ items: [] as CozeReference[], loading: false, error: "" });
  useEffect(() => {
    if (!active) return;
    let current = true;
    setResult({ items: [], loading: true, error: "" });
    void guiApi.request<CozeReference[]>({ operation: "cozeCatalog" }).then((items) => {
      if (current) setResult({ items, loading: false, error: "" });
    }).catch(() => {
      if (current) setResult({ items: [], loading: false,
        error: "请先从左侧打开 Coze，并发布需要使用的内容。" });
    });
    return () => { current = false; };
  }, [active]);
  return { ...result, error: result.error ? displayError(result.error) : "" };
}
