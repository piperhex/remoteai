# Linux 安装与使用

本文面向安装包用户，包含桌面启动、无桌面服务器、后台服务、网页访问和代理设置。
命令以 **Ubuntu 24.04 x64** 为例；从源码构建请参阅[开发文档](development.md)。

## 安装 Linux 包

从 [Releases](https://github.com/piperhex/remoteai/releases) 下载 Linux x64 安装包。
Ubuntu 优先使用 `.deb`，无需安装 Node.js、npm 或 Rust。
下面的 `codex-switch.deb` 代表下载的文件，请替换为实际文件名；路径中有空格时保留引号。

```bash
sudo apt update
sudo apt install "./codex-switch.deb"
command -v csw
```

使用 `apt install` 安装本地包可以同时处理系统依赖。安装后命令是 `csw`，通常位于 `/usr/bin/csw`。
有桌面环境时，可从应用菜单打开 Remote AI，或运行：

```bash
csw
```

如果下载的是 AppImage，在桌面环境中为文件添加执行权限后启动：

```bash
chmod +x "./CodexSwitch.AppImage"
./CodexSwitch.AppImage
```

同样需要将文件名替换为实际名称。AppImage 若提示缺少系统库或 FUSE，可改用 `.deb` 安装。
后面的后台服务示例使用 `.deb` 提供的 `/usr/bin/csw`。

### 界面语言

首次启动时，中文系统默认显示中文，其他语言环境默认显示英文。
应用跟随桌面环境提供的系统语言；Linux 的 `LANG`、`LC_MESSAGES`、`LC_ALL` 会影响这一设置。
也可在 **设置 / Settings → 语言 / Language** 中选择中文、英文或俄文，已保存的选择优先于系统语言。

### AppImage 提示 `AppRun.wrapped: Permission denied`

已确认 v1.6.17 和 v1.6.18 的 AppImage 内部启动文件缺少其他用户的执行权限，
在保留包内文件归属的解包或沙箱环境中可能无法打开窗口。仅给外层 `.AppImage` 文件添加执行权限无法修复它。
遇到这个错误时，Ubuntu 用户可先改用同版本的 `.deb`。

需要继续使用原 AppImage 时，可以在自己的用户目录解包后启动；以下操作不需要 `sudo`：

```bash
mkdir -p "$HOME/remote-ai-appimage"
cd "$HOME/remote-ai-appimage"
# 将下面路径替换为下载的 AppImage 文件路径。
chmod +x "$HOME/Downloads/CodexSwitch.AppImage"
"$HOME/Downloads/CodexSwitch.AppImage" --appimage-extract
chmod 755 squashfs-root/AppRun.wrapped
./squashfs-root/AppRun
```

源码中的打包修复会在生成安装包和签名前设置正确权限，发布流程也会检查成品权限并验证窗口启动。
这不会更改已经发布的 v1.6.17、v1.6.18 安装包。

## 无桌面服务器启动

`--headless` 不创建主窗口、托盘和悬浮球，但当前 Linux 包仍需初始化图形运行环境。
在纯命令行服务器上使用 Xvfb 提供虚拟显示：

```bash
sudo apt install xvfb xauth dbus-x11 xdg-utils python3
xvfb-run -a dbus-run-session -- csw --headless --port=18080
```

保留终端运行，在服务器本机访问 `http://127.0.0.1:18080`。远程访问方式见下文。
前台试运行结束后按 `Ctrl+C`，再配置后台服务。

- `--headless` 必须与 `--port` 一起使用，也支持 `--port 18080`。
- 端口范围是 `1–65535`。普通用户建议使用 `18080` 这样的高位端口；`80` 可能报权限不足。
- 默认只监听 `127.0.0.1`。`--port` 不会自动开启局域网访问，也没有 `--host` 参数。
- 命令行端口只对本次运行生效，监听范围由应用设置决定。
- 使用日常管理账号运行。用 `sudo csw` 会改用 root 的数据目录，不适合作为解决端口问题的方法。

## 后台运行与开机自启

以下示例使用已有的 `ubuntu` 用户，家目录为 `/home/ubuntu`。
如果你的用户名不同，请同步修改 `User`、`Group`、`WorkingDirectory` 和 `HOME`。
先退出同一用户启动的其他 Remote AI 实例，避免单实例机制把启动请求交给已有进程。

```bash
sudo tee /etc/systemd/system/codex-switch.service >/dev/null <<'EOF'
[Unit]
Description=Remote AI web interface
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu
Environment=HOME=/home/ubuntu
Environment=XDG_RUNTIME_DIR=/run/codex-switch
RuntimeDirectory=codex-switch
RuntimeDirectoryMode=0700
ExecStart=/usr/bin/xvfb-run -a /usr/bin/dbus-run-session -- /usr/bin/csw --headless --port=18080
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=20
LimitCORE=0

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now codex-switch.service
systemctl status codex-switch.service --no-pager
```

常用维护命令：

```bash
# 查看启动日志
journalctl -u codex-switch.service -n 100 --no-pager

# 重启、停止、取消开机自启
sudo systemctl restart codex-switch.service
sudo systemctl stop codex-switch.service
sudo systemctl disable codex-switch.service

# 检查开机自启、监听地址和网页响应
systemctl is-enabled codex-switch.service
ss -lntp | grep ':18080'
curl -I http://127.0.0.1:18080/
```

如果修改了服务文件，先执行 `sudo systemctl daemon-reload`，再重启服务。
服务中的 `--port=18080` 会在每次启动时指定端口；更换端口时应同步修改服务文件和网页设置。

## 从另一台电脑访问网页

### 方式一：SSH 隧道

保持默认的本机监听，在自己的电脑上执行下面的命令，替换用户名和服务器地址：

```bash
ssh -N -L 18080:127.0.0.1:18080 ubuntu@SERVER_IP
```

保持 SSH 连接，然后在这台电脑的浏览器打开 `http://127.0.0.1:18080`。
此方式不需要开放服务器的 `18080` 入站端口。若电脑本地端口已被占用，可将第一个 `18080`
改为 `18081`，并访问 `http://127.0.0.1:18081`。

### 方式二：监听 `0.0.0.0`

可以先通过 SSH 隧道进入网页，在 **设置 → 网页版 Remote AI 监听端口** 中保存端口，
开启“监听局域网”，再点击“复制网页版访问密钥”。也可在服务器上直接配置：

1. 停止后台服务。
2. 以运行服务的用户合并修改设置，保留已有账号和其他配置。
3. 启动服务，读取自动生成的网页版访问密钥。

以下 Python 命令应由示例中的 `ubuntu` 用户执行，**不要在前面加 `sudo`**：

```bash
sudo systemctl stop codex-switch.service
python3 - <<'PY'
import json
import os
import shutil
from pathlib import Path

os.umask(0o077)
data = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share")))
path = data / "dev.codex.switch/settings.json"
path.parent.mkdir(parents=True, exist_ok=True)
settings = json.loads(path.read_text()) if path.exists() else {}
if path.exists():
    shutil.copy2(path, path.with_name("settings.before-lan.json"))
settings.update(webProxyPort=18080, webProxyListenOnAllInterfaces=True)
path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n")
path.chmod(0o600)
PY
sudo systemctl start codex-switch.service
```

等 `systemctl status` 显示服务正常启动后，读取访问密钥：

```bash
python3 - <<'PY'
import json
import os
from pathlib import Path

data = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share")))
state = json.loads((data / "dev.codex.switch/state.json").read_text())
print(state["web_proxy_lan_api_key"])
PY
```

打开 `http://SERVER_IP:18080`，输入此密钥。`0.0.0.0` 是监听地址，浏览器中应填写服务器实际 IP。
云服务器还需在安全组及已启用的主机防火墙中允许可信来源访问 TCP `18080`。

**网页版访问密钥拥有完整管理权限**，包括账号、Provider、配置、会话和插件管理。
不要分享给只需要调用模型 API 的用户；他们应使用下面的代理 API Key。
跨公网管理优先使用 SSH 隧道或可信 VPN，避免直接通过明文 HTTP 传递管理密钥。
重新开启网页局域网监听或调整网页端口可能更换访问密钥，届时需要重新复制并登录。

## 配置账号、Provider 和模型代理

进入网页后，可导入账号 JSON，或在“三方模型及中转”中配置服务商地址、密钥和模型。
无桌面服务器优先使用浏览器上传账号文件；需要本机窗口或桌面应用的操作仍取决于服务器环境。
网页中的配置和任务作用于运行 Remote AI 的服务器。

### 开启代理的局域网监听

网页管理服务与模型代理分别监听不同端口，开启网页访问不会自动开启模型代理：

1. 点击顶部“启动代理”，等待启动完成。
2. 打开顶部“代理设置”。
3. 在“局域网 API Key”右侧点击“添加 Key”，填写名称。
4. 密钥留空可在保存时自动生成，也可填写已有密钥；额度留空表示不限，填 `0` 表示无可用额度。
5. 点击“保存”，确认列表中至少有一个已启用的 Key。
6. 开启“监听局域网”，然后在对应 Key 旁点击“复制 API Key”。

**Key 列表为空或全部停用时，“监听局域网”开关会变灰，这是正常的启用条件。**
网页登录使用的访问密钥不能代替此处的代理 API Key。浏览器中的复制操作会复制到当前电脑，
HTTP 页面也支持复制。监听开启后，至少需要保留一个已启用的 Key。

模型代理默认端口为 `15722`，以界面显示为准。另一台设备填写：

| 配置项 | 示例 |
| --- | --- |
| API Base URL | `http://SERVER_IP:15722/v1` |
| API Key | 在“代理设置”中保存并复制的 Key |

页面列出的 `127.0.0.1` 只供服务器本机使用，Docker 等虚拟网卡地址通常不能从外部访问。
同一局域网使用可达的内网 IP；通过公网连接云服务器时使用其公网 IP，并按需放行 TCP `15722`。
使用下面的额度查询验证 Key，不会发起模型生成请求：

```bash
read -r -s -p '代理 API Key: ' PROXY_API_KEY
printf '\n'
curl -H "Authorization: Bearer $PROXY_API_KEY" \
  http://SERVER_IP:15722/v1/codex-switch/quota
unset PROXY_API_KEY
```

### Remote AI 的出站网络代理

如果服务器通过 Clash 等代理访问上游，在 **设置 → 网络代理** 中启用并填写其实际监听地址。
例如 Clash 的 HTTP 代理确实运行在服务器 `127.0.0.1:7890` 时：

| 字段 | 填写值 |
| --- | --- |
| 代理地址 | `http://127.0.0.1` |
| 代理端口 | `7890` |

地址字段不包含端口或路径；地址和端口分开填写。`7890` 只是示例，需以 Clash 实际配置为准，
节点选择也在 Clash 中完成。这里的 `127.0.0.1` 指服务器，不是打开网页的电脑。

三类端口不要混用：

| 用途 | 本文示例 | 认证 |
| --- | --- | --- |
| 网页管理界面 | `18080` | 远程访问使用网页版访问密钥 |
| 模型代理 API | `15722` | 远程调用使用代理 API Key |
| Clash 出站代理 | `7890` | 由 Clash 配置决定 |

## 数据备份与升级

默认应用数据位于 `~/.local/share/dev.codex.switch/`，若设置了 `XDG_DATA_HOME` 则以该目录为准。
其中包含 `settings.json`、`state.json`、账号、Provider 和用量数据。
Codex 配置默认位于 `~/.codex/`，也可能由 `CODEX_HOME` 或应用中的 Codex Home 设置指定。
服务用户必须与首次配置时一致，才能读取同一份数据。

升级前停止服务并备份应用数据，再安装新包：

```bash
sudo systemctl stop codex-switch.service
umask 077
backup_dir="$HOME/codex-switch-backups/$(date +%Y%m%d-%H%M%S)"
app_data="${XDG_DATA_HOME:-$HOME/.local/share}/dev.codex.switch"
mkdir -p "$backup_dir"
tar -czf "$backup_dir/app-data.tar.gz" -C "$app_data" .
sudo cp /etc/systemd/system/codex-switch.service "$backup_dir/"
# 如使用了 Codex Home，另行备份相应目录，并保留上一版安装包。
sudo apt install "./codex-switch-new.deb"
sudo systemctl start codex-switch.service
systemctl status codex-switch.service --no-pager
```

备份包含密钥，应妥善保管。升级后刷新浏览器，并确认账号、代理配置和监听状态。
需要回退时停止服务、安装保留的旧包；如需恢复数据，也应在服务停止时操作。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| `127.0.0.1:80: Permission denied (os error 13)` | 普通用户绑定低位端口受到限制，改用 `--port=18080`。 |
| 提示无法打开显示或初始化 GTK 失败 | 安装 Xvfb，并使用本文的 `xvfb-run` 启动命令或服务配置。 |
| `failed to register desktop import links` | 检查 `xdg-utils`；这是桌面导入链接注册提示，继续检查后面的日志以确定网页是否启动。 |
| 提示模型目录刷新失败 | 检查服务器网络及出站代理；此提示本身不能说明网页监听失败。 |
| 提示端口已被占用 | 用 `ss -lntp` 确认占用进程，退出重复实例或改用空闲端口。 |
| 本机能打开，其他电脑打不开 | 检查是否监听 `0.0.0.0`、实际访问 IP、安全组和主机防火墙。 |
| “代理设置”的局域网开关变灰 | 先启动代理，再添加、保存并启用至少一个代理 API Key。 |
| 网页提示访问密钥错误 | 使用当前网页版访问密钥，勿填代理 Key；重新开启监听或更换网页端口后重新复制。 |
| 模型 API 返回 `401` | 使用已启用的代理 API Key，勿填网页登录密钥。 |
| 老版本网页操作返回 `This action is not available over LAN access` | 升级到包含网页完整管理权限的版本；当前版本仍保留访问密钥和请求来源校验。 |
| 修改设置后重启又恢复原值 | 不要在服务运行时直接编辑 JSON；检查服务用户、数据目录及 `ExecStart` 中的端口。 |

排障时先查看 `journalctl -u codex-switch.service -n 100 --no-pager`，再检查监听端口。
不要把整个 `state.json`、账号文件或密钥贴到公开 Issue 中。
