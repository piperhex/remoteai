import { messages1 } from "./messages1";
import { messages2 } from "./messages2";
import { messages3 } from "./messages3";
import { messages4 } from "./messages4";
import { messages5 } from "./messages5";
import { messages6 } from "./messages6";
import { messages7 } from "./messages7";
import { messages8 } from "./messages8";
import { mobile } from './mobile';
import { reliabilityRussian } from '../chatReliability';
import { reviewRussian } from '../taskReview';
import { downloads } from './downloads';
import { cliImportRussian } from '../cliImport';
import { assistanceRussian } from '../remoteAssistance';

export const russian = {
  '这台电脑暂不支持切换分辨率。': 'Этот компьютер пока не поддерживает изменение разрешения.',
  '下载未完成，请重新下载。': 'Загрузка не завершена. Скачайте файл заново.',
  '明亮': 'Светлое',
  '暗黑': 'Тёмное',
  '外观已切换，但未能保存。下次打开应用后请重新选择。':
    'Оформление изменено, но не сохранено. Выберите его снова при следующем запуске.',
  ...assistanceRussian,
  ...downloads,
  ...cliImportRussian,
  ...reliabilityRussian,
  ...reviewRussian,
  ...mobile,
  ...messages1,
  ...messages2,
  ...messages3,
  ...messages4,
  ...messages5,
  ...messages6,
  ...messages7,
  ...messages8,
} as const;
