import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deployWeb } from "./lib/web-deployment.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const [target, ...arguments_] = process.argv.slice(2);
const action = arguments_[0] && !arguments_[0].startsWith("-") ? arguments_.shift() : "up";

function deployAdmin() {
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "py" : "python3");
  const result = spawnSync(python, [
    "-B", "apps/admin/scripts/deployment_compose.py", action, ...arguments_,
  ], { cwd: repository, stdio: "inherit" });
  if (result.error) throw new Error("无法启动 Python 3，请安装后重试。");
  process.exitCode = result.status ?? 1;
}

try {
  if (target === "admin") deployAdmin();
  else if (target === "web") deployWeb({ action, arguments_, repository });
  else throw new Error("请选择 admin 或 web，例如 npm run deploy:web -- check --project-name web。");
} catch (error) {
  console.error(error instanceof Error ? error.message : "部署失败，请检查配置后重试。");
  process.exitCode = 1;
}
