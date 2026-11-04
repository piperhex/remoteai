import { uiText } from "../../../../shared/localization/uiText";

const ACCOUNT_FILE_ACCEPT = ".json,.jsonl,.ndjson";
const MAX_ACCOUNT_FILE_BYTES = 20 * 1024 * 1024;

/** Read the file selected on this browser's device; never send a host filesystem path. */
export function chooseBrowserAccountFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCOUNT_FILE_ACCEPT;
    input.hidden = true;
    const cleanup = () => input.remove();
    input.addEventListener("cancel", () => { cleanup(); resolve(null); }, { once: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) { resolve(null); return; }
      if (file.size > MAX_ACCOUNT_FILE_BYTES) {
        reject(new Error(uiText("client.desktopMisc.chooseAnAccountFileSmallerThan20Mb")));
        return;
      }
      void file.text().then(resolve, reject);
    }, { once: true });
    document.body.append(input);
    input.click();
  });
}
