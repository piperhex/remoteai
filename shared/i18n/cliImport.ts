export const cliImportEnglish: Readonly<Record<string, string>> = {
  "Codex 安装意外中断，请重启应用后重试。":
    "Codex installation was interrupted. Restart the app and try again.",
  "安装所在磁盘空间不足，请释放空间后重试。":
    "The installation disk is full. Free up space and try again.",
  "没有权限访问安装文件，请检查文件夹权限后重试。":
    "Access to the installation files was denied. Check folder permissions and try again.",
  "安装文件被其他程序占用，请关闭相关程序后重试。":
    "Another program is using the installation files. Close it and try again.",
  "无法创建安装文件夹，请检查文件夹是否可写后重试。":
    "Unable to create the installation folder. Check that the folder is writable and try again.",
  "无法写入安装文件，请检查磁盘是否可写后重试。":
    "Unable to write installation files. Check that the disk is writable and try again.",
  "无法读取安装文件，请重新选择安装包或重新下载。":
    "Unable to read installation files. Select the package again or download it again.",
  "安装包无法解压，可能已损坏。请重新下载完整安装包。":
    "The package could not be extracted and may be damaged. Download the complete package again.",
  "安装包缺少 Codex 启动文件，请下载适合当前电脑的完整安装包。":
    "The package is missing the Codex executable. Download the complete package for this computer.",
  "无法读取已安装版本的信息，请在日志诊断中查看详情。":
    "Unable to read the installed version information. Check Log diagnostics for details.",
  "无法保存安装结果，请检查磁盘是否可写后重试。":
    "Unable to save the installation result. Check that the disk is writable and try again.",
  "非必填": "Optional",
  "移除": "Remove",
  "安装包无效或不适合当前电脑，请重新下载完整安装包。":
    "The package is invalid or incompatible with this computer. Download the complete package again.",
  "手动下载":
    "Manual download",
  "手动下载 Codex":
    "Download Codex manually",
  "下载完整安装包后，直接选择文件并导入，无需解压。版本校验文件可按需添加。":
    "Download the complete package and import it without extracting it. The verification file is optional.",
  "适用于 {platform}":
    "For {platform}",
  "1. 完整安装包":
    "1. Complete package",
  "2. 版本校验文件":
    "2. Release verification file",
  "打开链接后，将页面另存为文件即可，无需修改文件名或后缀。":
    "Open the link and save the page as a file. Keep its original name and extension.",
  "如添加校验文件，请选择同一版本。导入无需联网；有对话正在运行时，更新会稍后安装。":
    "Use a verification file from the same release, if provided. " +
    "Import works offline; updates wait until chats are idle.",
  "下载文件":
    "Download file",
  "选择完整安装包":
    "Select the complete package",
  "选择版本校验文件":
    "Select the release verification file",
  "所有文件":
    "All files",
  "选择文件":
    "Choose file",
  "重新选择":
    "Choose another file",
  "已选择：{filename}":
    "Selected: {filename}",
  "导入并安装":
    "Import and install",
  "正在准备下载链接…":
    "Preparing download links…",
  "正在检查文件并导入，请稍候…":
    "Verifying and importing files. Please wait…",
  "暂时无法准备下载链接，请关闭后重试。":
    "Unable to prepare download links. Close this window and try again.",
  "暂时无法选择文件，请重试。":
    "Unable to select a file. Please try again.",
  "导入未完成，请确认所选文件下载完整后重试。":
    "Import failed. Check that the selected files finished downloading and try again.",
  "导入成功，更新将在空闲时或下次启动时安装。":
    "Imported successfully. The update will install when idle or on the next launch.",
  "Codex 已安装，可以开始使用了。":
    "Codex is installed and ready to use.",
  "所选文件无法读取，请重新选择下载好的文件。":
    "The selected file cannot be read. Select the downloaded file again.",
  "版本校验文件无效，请从引导中的官方链接重新下载。":
    "The verification file is invalid. Download it again using the official link above.",
  "安装包与校验文件不匹配，请下载同一版本、适合当前电脑的文件。":
    "The files do not match. Download both files for the same release and this computer.",
  "此版本已安装，或已有更新版本。请下载最新版本后再导入。":
    "This version is already installed or a newer one is available. Download the latest release before importing.",
};

export const cliImportRussian: Readonly<Record<string, string>> = {
  "Codex 安装意外中断，请重启应用后重试。":
    "Установка Codex прервана. Перезапустите приложение и попробуйте снова.",
  "安装所在磁盘空间不足，请释放空间后重试。":
    "На диске для установки нет места. Освободите место и попробуйте снова.",
  "没有权限访问安装文件，请检查文件夹权限后重试。":
    "Нет доступа к файлам установки. Проверьте права доступа к папке и попробуйте снова.",
  "安装文件被其他程序占用，请关闭相关程序后重试。":
    "Файлы установки заняты другой программой. Закройте её и попробуйте снова.",
  "无法创建安装文件夹，请检查文件夹是否可写后重试。":
    "Не удалось создать папку установки. Проверьте доступность папки для записи и попробуйте снова.",
  "无法写入安装文件，请检查磁盘是否可写后重试。":
    "Не удалось записать файлы установки. Проверьте доступность диска для записи и попробуйте снова.",
  "无法读取安装文件，请重新选择安装包或重新下载。":
    "Не удалось прочитать файлы установки. Выберите пакет ещё раз или скачайте его заново.",
  "安装包无法解压，可能已损坏。请重新下载完整安装包。":
    "Не удалось распаковать пакет: возможно, он повреждён. Скачайте полный пакет заново.",
  "安装包缺少 Codex 启动文件，请下载适合当前电脑的完整安装包。":
    "В пакете нет файла запуска Codex. Скачайте полный пакет для этого компьютера.",
  "无法读取已安装版本的信息，请在日志诊断中查看详情。":
    "Не удалось прочитать сведения об установленной версии. Подробности — в диагностике журналов.",
  "无法保存安装结果，请检查磁盘是否可写后重试。":
    "Не удалось сохранить результат установки. Проверьте доступность диска для записи и попробуйте снова.",
  "非必填": "Необязательно",
  "移除": "Убрать",
  "安装包无效或不适合当前电脑，请重新下载完整安装包。":
    "Пакет недействителен или несовместим с этим компьютером. Скачайте полный пакет заново.",
  "手动下载":
    "Скачать вручную",
  "手动下载 Codex":
    "Скачать Codex вручную",
  "下载完整安装包后，直接选择文件并导入，无需解压。版本校验文件可按需添加。":
    "Скачайте полный пакет и импортируйте его без распаковки. Файл проверки можно добавить по желанию.",
  "适用于 {platform}":
    "Для {platform}",
  "1. 完整安装包":
    "1. Полный установочный пакет",
  "2. 版本校验文件":
    "2. Файл проверки версии",
  "打开链接后，将页面另存为文件即可，无需修改文件名或后缀。":
    "Откройте ссылку и сохраните страницу как файл, не меняя имя или расширение.",
  "如添加校验文件，请选择同一版本。导入无需联网；有对话正在运行时，更新会稍后安装。":
    "Файл проверки должен быть той же версии. Импорт работает офлайн; обновление дождётся завершения диалогов.",
  "下载文件":
    "Скачать файл",
  "选择完整安装包":
    "Выберите полный установочный пакет",
  "选择版本校验文件":
    "Выберите файл проверки версии",
  "所有文件":
    "Все файлы",
  "选择文件":
    "Выбрать файл",
  "重新选择":
    "Выбрать другой файл",
  "已选择：{filename}":
    "Выбрано: {filename}",
  "导入并安装":
    "Импортировать и установить",
  "正在准备下载链接…":
    "Подготовка ссылок для скачивания…",
  "正在检查文件并导入，请稍候…":
    "Проверка и импорт файлов. Подождите…",
  "暂时无法准备下载链接，请关闭后重试。":
    "Не удалось подготовить ссылки. Закройте окно и попробуйте снова.",
  "暂时无法选择文件，请重试。":
    "Не удалось выбрать файл. Попробуйте снова.",
  "导入未完成，请确认所选文件下载完整后重试。":
    "Импорт не завершён. Убедитесь, что выбранные файлы скачаны полностью, и попробуйте снова.",
  "导入成功，更新将在空闲时或下次启动时安装。":
    "Импорт завершён. Обновление установится после завершения задач или при следующем запуске.",
  "Codex 已安装，可以开始使用了。":
    "Codex установлен и готов к работе.",
  "所选文件无法读取，请重新选择下载好的文件。":
    "Не удалось прочитать выбранный файл. Выберите скачанный файл ещё раз.",
  "版本校验文件无效，请从引导中的官方链接重新下载。":
    "Файл проверки недействителен. Скачайте его заново по официальной ссылке выше.",
  "安装包与校验文件不匹配，请下载同一版本、适合当前电脑的文件。":
    "Файлы не совпадают. Скачайте оба файла одной версии для этого компьютера.",
  "此版本已安装，或已有更新版本。请下载最新版本后再导入。":
    "Эта версия уже установлена или доступна более новая. Скачайте последнюю версию для импорта.",
};
