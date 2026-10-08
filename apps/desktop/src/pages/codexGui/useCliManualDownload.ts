import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { guiText } from "../../i18n/guiText";
import { cliDownloadLinks, importCliPackage, type CliDownloadLinks, type CliSnapshot } from "./cliManualDownloadApi";

export function useCliManualDownload(version: string | null, onImported: (value: CliSnapshot) => Promise<void>) {
  const [links, setLinks] = useState<CliDownloadLinks | null>(null);
  const [packagePath, setPackagePath] = useState("");
  const [metadataPath, setMetadataPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<CliSnapshot | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    void cliDownloadLinks(version).then(value => { if (!cancelled) setLinks(value); })
      .catch(() => { if (!cancelled) setError(guiText("暂时无法准备下载链接，请关闭后重试。")); });
    return () => { cancelled = true; };
  }, [version]);

  const choose = async (kind: "package" | "metadata") => {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try {
      const selected = await open({ multiple: false, directory: false,
        title: guiText(kind === "package" ? "选择完整安装包" : "选择版本校验文件"),
      });
      if (typeof selected === "string" && mounted.current) {
        (kind === "package" ? setPackagePath : setMetadataPath)(selected);
        setError(""); setResult(null);
      }
    } catch { if (mounted.current) setError(guiText("暂时无法选择文件，请重试。")); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };

  const importFiles = async () => {
    if (locked.current || !packagePath || !metadataPath) return;
    locked.current = true; setBusy(true); setImporting(true); setError(""); setResult(null);
    try {
      const imported = await importCliPackage({ packagePath, metadataPath });
      await onImported(imported);
      if (mounted.current) setResult(imported);
    } catch (cause) {
      if (mounted.current) setError(typeof cause === "string" ? guiText(cause)
        : guiText("导入未完成，请确认两个文件下载完整后重试。"));
    } finally {
      locked.current = false;
      if (mounted.current) { setBusy(false); setImporting(false); }
    }
  };
  return { links, packagePath, metadataPath, error, busy, importing, result, choose, importFiles };
}
