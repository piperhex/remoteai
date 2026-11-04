import { uiText } from "../../../../../shared/localization/uiText";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import type { Content, SkillReference } from "../../../../../shared/conversation/types";
import { IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, readImage, type DraftImage } from "./draftImages";
import { queuedMessageText } from "../../../../../shared/conversation/queuedMessageDraft";
import type { MessageEditContent } from "../../../../../shared/conversation/messageEditContent";

export function useMessageEditDraft({ text, images, skills }: {
  text: string; images: Content[]; skills: SkillReference[];
}) {
  const [draft, setDraft] = useState(() => queuedMessageText({ text, images: [], skills }));
  const [removed, setRemoved] = useState<number[]>([]);
  const [added, setAdded] = useState<DraftImage[]>([]);
  const [error, setError] = useState("");
  const pending = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current.clear(); };
  }, []);
  const remove = (index: number) => {
    if (index < images.length) setRemoved((values) => [...values, index]);
    else {
      const image = added[index - images.length];
      pending.current.delete(image.id);
      setAdded((values) => values.filter((entry) => entry.id !== image.id));
    }
    setError("");
  };
  const paste = (event: ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.items).filter((item) => item.kind === "file")
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (!files.length) return;
    event.preventDefault();
    setError("");
    const valid = files.filter((file) => IMAGE_TYPES.includes(file.type) && file.size > 0
      && file.size <= MAX_IMAGE_BYTES);
    if (valid.length !== files.length) setError(uiText("client.workspaceActions.pastePngJpgWebpOrGifImagesUpTo20"));
    const available = Math.max(0, MAX_IMAGES - images.length + removed.length
      - added.filter((image) => image.url).length - pending.current.size);
    if (valid.length > available) setError(uiText("client.workspaceActions.youCanAddUpTo8ImagesPerMessage"));
    const additions = valid.slice(0, available).map((file) => ({ file, id: crypto.randomUUID() }));
    additions.forEach(({ id }) => pending.current.add(id));
    setAdded((values) => [...values, ...additions.map(({ id, file }) => ({ id, name: file.name }))]);
    for (const { id, file } of additions) {
      void readImage(file).then((url) => {
        if (mounted.current && pending.current.delete(id)) {
          setAdded((values) => values.map((image) => image.id === id ? { ...image, url } : image));
        }
      }).catch(() => {
        if (!mounted.current || !pending.current.delete(id)) return;
        setAdded((values) => values.filter((image) => image.id !== id));
        setError(uiText("client.workspaceActions.couldNotReadTheImagePleasePasteItAgain"));
      });
    }
  };
  const content = (): MessageEditContent => {
    const selectedSkills = [...new Map(draft.mentions.map(({ skill }) =>
      [skill.path, { name: skill.name, path: skill.path }])).values()];
    return { text: draft.text, ...(removed.length ? { removedImageIndexes: removed } : {}),
      ...(added.length ? { images: added.flatMap((image) => image.url ? [image.url] : []) } : {}),
      ...(skills.length || selectedSkills.length ? { skills: selectedSkills } : {}) };
  };
  return { draft, setDraft, removed, error, remove, paste, content,
    images: [...images, ...added.map((image): Content => ({ type: "image", url: image.url }))],
    reading: added.some((image) => !image.url), isReading: () => pending.current.size > 0 };
}
