export const remoteDesktopMessages: Record<string, string> = {
  '未能获取 Mac 的屏幕画面。请确认电脑已登录；若已开启屏幕录制仍无效，请在 Mac 的远程设置中修复权限。':
    'Could not capture the Mac screen. Make sure you are signed in. '
    + 'If Screen Recording is already allowed, repair permissions in Remote settings on the Mac.',
  '已开启仍无法使用？修复权限': 'Enabled but not working? Repair permissions',
  '修复屏幕录制权限？': 'Repair Screen Recording permission?',
  '修复辅助功能权限？': 'Repair Accessibility permission?',
  '修复屏幕录制权限': 'Repair Screen Recording permission',
  '修复辅助功能权限': 'Repair Accessibility permission',
  '将清除 Remote AI 的屏幕录制授权，相关远程操作可能中断。请重新授权后重启应用。':
    'This clears Remote AI’s Screen Recording permission and may interrupt remote access. '
    + 'Allow access again, then restart the app.',
  '将清除 Remote AI 的辅助功能授权，相关远程操作可能中断。请重新授权后重启应用。':
    'This clears Remote AI’s Accessibility permission and may interrupt remote control. '
    + 'Allow access again, then restart the app.',
  '重置并去授权': 'Reset and allow access',
  '重新授权后请重启应用': 'Allow access again, then restart the app',
  '权限已重置，请重新授权': 'Permission reset. Allow access again',
  '请在系统设置中为 Remote AI 重新开启对应权限。完成后保存工作并重启应用，再连接远程桌面。':
    'Allow the selected permission for Remote AI in System Settings. Save your work, restart the app, then reconnect.',
  '完成授权后重启': 'Restart after allowing access',
  '更新或改名后无法连接，可尝试修复权限；若系统仍显示旧名称，请移除旧条目并重新添加当前应用。':
    'If an update or rename prevents connection, try repairing permissions. '
    + 'If Settings still shows the old name, remove that entry and add the current app.',
  '权限已重置，请手动打开系统设置，在“隐私与安全性”中重新开启。':
    'Permission was reset. Open System Settings manually and allow access under Privacy & Security.',
  '未能重置权限，请在系统设置的“隐私与安全性”中移除旧应用，再重新添加 Remote AI。':
    'Could not reset permission. Remove the old app from Privacy & Security in System Settings, then add Remote AI again.',
  '未能重启，请完全退出 Remote AI 后重新打开。': 'Could not restart. Quit Remote AI completely, then open it again.',
  '请在 Mac 上允许屏幕录制，必要时重启 Remote AI，随后将自动连接。已开启仍无效？请在 Mac 的远程设置中修复权限。':
    'Allow Screen Recording on the Mac and restart Remote AI if needed to connect automatically. '
    + 'Already enabled? Repair permissions in Remote settings on the Mac.',
  '请在 Mac 上允许辅助功能，必要时重启 Remote AI，随后将自动连接。已开启仍无效？请在 Mac 的远程设置中修复权限。':
    'Allow Accessibility on the Mac and restart Remote AI if needed to connect automatically. '
    + 'Already enabled? Repair permissions in Remote settings on the Mac.',
  '隐私屏': 'Privacy screen',
  '这台电脑暂不支持隐私屏。': 'Privacy screen is unavailable on this computer.',
  '正在切换隐私屏，请稍候。': 'Switching privacy screen. Please wait.',
  '隐私屏未能切换，请重试。': 'Could not switch privacy screen. Please try again.',
  '隐私屏未能切换，请重新连接后重试。': 'Could not switch privacy screen. Reconnect and try again.',
  '请先在电脑的远程设置中开启无人值守，再使用隐私屏。':
    'Enable unattended access in the computer’s remote settings to use privacy screen.',
  '调整远程桌面的显示效果': 'Adjust how your remote desktop looks',
  '显示设置选项': 'Display settings options',
  '选择要使用的显示器': 'Choose the monitor to use',
  '连接后不在屏幕上显示状态信息': 'Keep connection stats off the screen',
  '更高的帧率让画面更流畅，也会占用更多带宽':
    'Higher frame rates make motion smoother and use more bandwidth',
  '在画质、流畅度和带宽之间取得平衡': 'Balance clarity, smoothness and bandwidth',
  '在远程桌面中使用鼠标的操作方式': 'How to use the mouse on your remote desktop',
  '滑动画面或鼠标下半部可移动指针，轻点即可单击。':
    'Swipe the screen or lower mouse pad to move the pointer; tap to click.',
  '按住左键滑动可拖拽，松手结束；长按不动可锁定拖拽，再点左键结束。':
    'Slide while holding the left button to drag; release to stop. Hold still to lock dragging; tap again to release.',
  '按住中央箭头并拖动可滚动，松手返回鼠标面板。':
    'Hold and drag the center arrows to scroll; release to return to the mouse panel.',
  '拖动横线把手可移动鼠标面板。': 'Drag the horizontal grip to move the mouse panel.',
  '检查授权': 'Check permissions',
  '请在 Mac 上允许屏幕录制，授权后将自动连接。若系统要求，请重启 Remote AI。':
    'Allow Screen Recording on the Mac to connect automatically. Restart Remote AI if macOS asks you to.',
  '请在 Mac 上允许辅助功能，授权后将自动连接。若系统要求，请重启 Remote AI。':
    'Allow Accessibility on the Mac to connect automatically. Restart Remote AI if macOS asks you to.',
  '正在启用无人值守，请在弹出的窗口中确认管理员权限。':
    'Enabling unattended access. Approve the administrator prompt when it appears.',
  '无人值守未能启用。你可以继续对话，稍后到远程设置中重试。':
    'Unattended access could not be enabled. You can keep chatting and retry later in Remote settings.',
  '仅观看': 'View only',
  '桌面已就绪。打开远程桌面，登录电脑后即可继续聊天。':
    'The desktop is ready. Open remote desktop and sign in to the computer to continue chatting.',
  '请先登录电脑并打开聊天，再发送消息。': 'Sign in to the computer and open chat before sending a message.',
  '连接已断开，正在重连…': 'Connection lost. Reconnecting…',
  '远程电脑已断开，恢复在线后将自动重连。': 'The remote computer disconnected. We’ll reconnect when it is back online.',
  '远程桌面暂时无法显示': 'Unable to display the remote desktop',
  '请重新连接，或关闭后再试。': 'Reconnect, or close the viewer and try again.',
  '正在恢复桌面连接…': 'Restoring the desktop connection…',
  '核对电脑身份': 'Verify computer identity',
  '设备指纹': 'Device fingerprint',
  '核对并重新连接': 'Verify and reconnect',
  '请在电脑的设置中找到“远程桌面”，复制设备指纹并粘贴到下方。':
    'Open Remote desktop in the computer’s settings, copy its device fingerprint and paste it below.',
  '指纹不一致，请重新核对电脑上的设备指纹。': 'The fingerprint does not match. Check the computer’s fingerprint again.',
  '电脑身份已变化，请先核对电脑上的设备指纹。': 'The computer’s identity changed. Verify its device fingerprint first.',
  '已复制到本机，可直接粘贴。': 'Copied to this device. Ready to paste.',
  '复制后，在另一台电脑上粘贴即可。支持文本、图片和文件。':
    'Copy on one computer and paste on the other. Supports text, images and files.',
  '每次最多 64 MB、32 个文件，文件夹请先压缩。': 'Up to 64 MB and 32 files at a time. Zip folders first.',
  '输入法': 'Input method', '快捷键': 'Shortcuts', '电脑键盘': 'Computer keyboard', '远程输入': 'Remote input',
  '输入方式': 'Input mode', '收起键盘': 'Hide keyboard', '组合键模式': 'Key combinations',
  '字母键盘': 'Letter keys', '符号和功能键': 'Symbols and function keys',
  '大小写锁定': 'Caps lock', '开始': 'Start', '切换窗口': 'Switch windows', '锁定屏幕': 'Lock screen',
  '剪切': 'Cut', '全选': 'Select all', '撤销': 'Undo',
  '输入文字，即时发送到电脑': 'Type to send directly to your computer',
  '更新远程电脑上的应用后，即可使用这些按键。': 'Update the app on the remote computer to use these keys.',
  '按住并拖动以滚动': 'Hold and drag to scroll', '十字滚动滑块': 'Scroll control',
  '更新远程电脑上的应用后，即可左右滚动。': 'Update the remote computer app to scroll horizontally.',
  '剪贴板': 'Clipboard', '远程桌面键盘输入': 'Remote desktop keyboard input',
  '请更新远程电脑上的应用，启用实体键盘和剪贴板。':
    'Update the app on the remote computer to enable physical keyboard and clipboard support.',
  '粘贴到远程': 'Paste to remote', '获取远程剪贴板': 'Get remote clipboard', '发送文件': 'Send files',
  '选择发送的文件': 'Choose files to send', '复制到本机': 'Copy to this device',
  '远程剪贴板文本': 'Remote clipboard text', '远程剪贴板图片': 'Remote clipboard image',
  '在桌面中使用 Ctrl+C、Ctrl+X 和 Ctrl+V，复制粘贴文本、图片和文件。':
    'Use Ctrl+C, Ctrl+X and Ctrl+V in the desktop to copy and paste text, images and files.',
  '每次最多 64 MB、32 个文件。远程文件会下载到本机；文件夹请先压缩。':
    'Up to 64 MB and 32 files at a time. Remote files download to this device. Zip folders before copying.',
  '正在传输剪贴板…': 'Transferring clipboard…', '已粘贴到远程电脑。': 'Pasted to the remote computer.',
  '已复制到本机。': 'Copied to this device.', '文件已收到，可在下方下载。': 'Files received. Download them below.',
  '内容已收到，请点击“复制到本机”。': 'Content received. Click “Copy to this device”.',
  '剪贴板传输失败，请重试。': 'Clipboard transfer failed. Please try again.',
  '请等待桌面连接后重试。': 'Wait for the desktop to connect, then try again.',
  '剪贴板正在传输，请稍候。': 'A clipboard transfer is in progress. Please wait.',
  '剪贴板传输超时，请重试。': 'The clipboard transfer timed out. Please try again.',
  '剪贴板内容无效，请重新复制。': 'Invalid clipboard content. Please copy it again.',
  '剪贴板内容过大，请分批复制。': 'The clipboard content is too large. Copy it in smaller batches.',
  '剪贴板内容过大，请分批复制（每次最多 64 MB）。': 'Copy in smaller batches, up to 64 MB at a time.',
  '剪贴板内容过大，请分批复制（每次最多 64 MB、32 个文件）。':
    'Copy in smaller batches, up to 64 MB and 32 files at a time.',
  '无法访问剪贴板，请重新复制后再试。': 'Unable to access the clipboard. Copy the content again and retry.',
  '暂不支持复制文件夹，请先压缩后再复制。': 'Zip folders before copying them.',
  '未能复制所选内容，请确认远程窗口后重试。': 'Unable to copy the selection. Check the remote window and try again.',
  '图片过大，请缩小后再复制。': 'The image is too large. Resize it before copying.',
  '图片未能读取，请重新复制。': 'Unable to read the image. Please copy it again.',
  '图片未能读取，请保存后选择文件发送。': 'Save the image, then choose the file to send it.',
  '浏览器未开放剪贴板，请点击桌面后按 Ctrl+V。': 'Click the desktop and press Ctrl+V to paste.',
  '浏览器未开放剪贴板，请手动复制下面的内容。': 'Clipboard access is unavailable. Copy the content below manually.',
  '无法读取本机剪贴板，请点击桌面后按 Ctrl+V，或选择文件发送。':
    'Click the desktop and press Ctrl+V, or choose files to send.',
  '剪贴板中没有可发送的内容，请重新复制或选择文件。': 'Copy some content or choose files to send.',
  '无法写入本机剪贴板，请允许浏览器访问，或手动复制下面的内容。':
    'Allow clipboard access in your browser, or copy the content below manually.',
  '显示器': 'Monitor', '主屏': 'Primary', '正在切换显示器…': 'Switching display…',
  '请选择有效的显示器。': 'Choose a valid display.',
  '显示器已断开，请重新连接桌面。': 'The display was disconnected. Please reconnect.',
  '声音': 'Sound', '开启声音': 'Enable sound', '静音': 'Mute', '声音暂不可用': 'Sound unavailable',
  '远程桌面': 'Remote desktop', '远程桌面操作': 'Remote desktop controls',
  '远程桌面窗口操作': 'Remote desktop window controls', '恢复远程桌面': 'Restore remote desktop',
  '打开远程桌面': 'Open remote desktop', '正在后台运行': 'Running in the background',
  '远程桌面正在后台运行，点击恢复': 'Remote desktop is running in the background. Click to restore.',
  '最小化': 'Minimize', '退出全屏': 'Exit fullscreen',
  '暂时无法切换全屏，请重试。': 'Unable to switch fullscreen. Please try again.',
  '暂时无法退出全屏，请重试。': 'Unable to exit fullscreen. Please try again.',
  '远程桌面触控区域': 'Remote desktop touchpad', '显示设置': 'Display settings',
  '显示': 'Display', '帧率': 'Frame rate', '帧': 'FPS', '帧/秒': 'FPS',
  '连接状态': 'Connection stats', '关闭连接状态': 'Close connection stats',
  '隐藏连接状态': 'Hide connection stats', '显示连接状态': 'Show connection stats',
  '延迟': 'latency', '解码': 'decode', '丢包': 'loss', '网络': 'network',
  'Ethernet': 'Ethernet', 'Cellular': 'Cellular',
  '在鼠标面板外，双指张合缩放画面，双指滑动平移画面。':
    'Outside the mouse controls, pinch to zoom and swipe with two fingers to pan.',
  '自定义帧率': 'Custom frame rate', '应用帧率': 'Apply frame rate', '画质': 'Quality',
  '流畅': 'Smooth', '高清': 'High', '超清': 'Ultra',
  '支持 1–144 帧。实际帧率取决于网络和电脑性能。': 'Choose 1–144 FPS. Actual performance depends on your network and computer.',
  '请输入 1–144 的整数。': 'Enter a whole number from 1 to 144.',
  '自动模式优先使用最高画质和 60 帧。网络不稳时先降帧，尽量保持清晰。':
    'Auto starts at the highest quality and 60 FPS. If the connection slows, frame rate drops first to preserve clarity.',
  '触屏': 'Touch', '展开鼠标面板': 'Expand mouse controls',
  '切换为触屏模式': 'Switch to touch mode', '切换为鼠标模式': 'Switch to mouse mode',
  '鼠标操作': 'Mouse controls', '鼠标': 'Mouse', '键盘': 'Keyboard',
  '鼠标左键': 'Left mouse button', '鼠标右键': 'Right mouse button', '左键': 'Left', '右键': 'Right',
  '向上滚动': 'Scroll up', '向下滚动': 'Scroll down', '拖动鼠标面板': 'Move mouse panel',
  '滑动移动': 'Swipe to move', '拖拽中': 'Dragging', '显示桌面': 'Show desktop', '所有窗口': 'All windows',
  '发送到电脑的文字': 'Text to send to your computer', '输入文字': 'Enter text', '退格': 'Backspace', '回车': 'Enter',
  '滑动画面或鼠标下半部移动指针，轻点单击。按住左键滑动即可拖拽，松手结束；长按不动可锁定拖拽，再点左键结束。按住中央箭头并拖动可滚动，松手返回鼠标面板。横线把手可移动鼠标面板。':
    'Swipe the screen or lower mouse pad to move; tap to click. Slide while holding the left button to drag, then release '
      + 'to stop. Hold it still to lock dragging; tap it again to release. Hold and drag the center arrows to scroll; '
      + 'release to return to the mouse panel. Use the center grip to reposition the panel.',
  '正在连接桌面…': 'Connecting to the desktop…',
  '桌面连接超时，请检查两端网络后重试。': 'Connection timed out. Check both devices’ networks and try again.',
  '桌面连接已断开，请重新连接。': 'The desktop disconnected. Please reconnect.',
  '网络中断，正在等待恢复…': 'Connection interrupted. Waiting to reconnect…',
  '桌面连接异常，请重新连接。': 'The desktop connection failed. Please reconnect.',
  '桌面连接未能建立，请检查网络后重试。': 'Unable to connect to the desktop. Check your network and try again.',
  '暂时无法打开远程桌面，请重试。': 'Unable to open the remote desktop. Please try again.',
  '显示设置未能保存，请重试。': 'Unable to save display settings. Please try again.',
  '无法访问桌面，请确认电脑已解锁后重试。': 'Unable to access the desktop. Unlock your computer and try again.',
  '这台电脑暂不支持远程桌面，请使用 Windows 电脑。': 'This computer does not support remote desktop yet. Use a Windows computer.',
  '已有远程桌面连接，请先关闭后再试。': 'A remote desktop is already connected. Close it before trying again.',
  '请在 Mac 的远程设置中开启屏幕录制权限，然后重新连接。':
    'Enable Screen Recording in Remote settings on your Mac, then reconnect.',
  '请在 Mac 的远程设置中开启辅助功能权限，然后重新连接。':
    'Enable Accessibility in Remote settings on your Mac, then reconnect.',
  '远程桌面需要 macOS 13 或更新版本。': 'Remote desktop requires macOS 13 or later.',
  '这台电脑暂不支持远程桌面，请使用 Windows 或 Mac 电脑。':
    'Remote desktop is unavailable on this computer. Use a Windows PC or Mac.',
  '远程桌面暂不可用，请更新电脑端应用后重试。':
    'Remote desktop is unavailable. Update the app on the computer and try again.',
  '远程桌面设置未能读取，请在电脑端重新打开远程设置。':
    'Unable to read remote desktop settings. Reopen Remote settings on the computer.',
  '未能读取显示器信息，请在电脑端重新连接显示器后重试。':
    'Unable to read display information. Reconnect the display to the computer and try again.',
  '未找到可用显示器，请确认电脑已连接显示器并登录桌面。':
    'No display is available. Connect a display and sign in to the computer.',
  '未能启动屏幕共享，请重新打开电脑端应用后重试。':
    'Unable to start screen sharing. Reopen the app on the computer and try again.',
  '未能获取屏幕画面，请确认电脑已登录桌面后重试。':
    'Unable to capture the screen. Sign in to the computer and try again.',
  '获取屏幕画面超时，请重新连接。': 'Screen capture timed out. Please reconnect.',
  '暂时无法共享屏幕，请更新两端应用后重试。':
    'Screen sharing is unavailable. Update the app on both devices and try again.',
};
