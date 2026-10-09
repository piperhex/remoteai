const zh = {
  title: '官方账户跨设备用量', account: '官方账户', devices: '设备', tokens: 'Token 消耗',
  cost: '消耗金额（{unit}）', remaining: '预估可用额度（{unit}）', capacity: '100% 额度预估（{unit}）',
  primary: '主要额度', secondary: '次要额度', unavailable: '暂无足够数据',
  hint: '根据最近连续下降阶段的消耗，估算完整额度和当前剩余额度，仅供参考。',
  detail: '用下降阶段的消耗除以下降百分点，换算完整额度和剩余额度；有两种额度限制时取较小值。',
  signedOut: '登录后可查看跨设备用量与额度预估。', ready: '汇总各设备记录的官方账户用量。',
  unavailableStatus: '暂时无法读取账户用量，请稍后重试。',
  updated: '更新于', empty: '暂无官方账户用量',
};
type Labels = { [Key in keyof typeof zh]: string };
const en: Labels = {
  title: 'Official account usage across devices', account: 'Official account', devices: 'Devices', tokens: 'Tokens used',
  cost: 'Usage cost ({unit})', remaining: 'Estimated available ({unit})', capacity: 'Estimated 100% quota ({unit})',
  primary: 'Primary quota', secondary: 'Secondary quota', unavailable: 'Not enough data',
  hint: 'Full and remaining quota estimated from usage during the latest continuous decline. For reference only.',
  detail: 'Divides usage cost by the percentage points lost to estimate full and remaining quota. '
    + 'The lower available amount applies when two quota limits exist.',
  signedOut: 'Sign in to view usage across devices and quota estimates.',
  ready: 'Includes official account usage recorded by each device.',
  unavailableStatus: 'Account usage is temporarily unavailable. Please try again later.',
  updated: 'Updated', empty: 'No official account usage',
};
const ru: Labels = {
  title: 'Расход официальных аккаунтов на устройствах', account: 'Официальный аккаунт', devices: 'Устройства',
  tokens: 'Расход токенов', cost: 'Стоимость ({unit})', remaining: 'Доступно, оценка ({unit})',
  capacity: 'Оценка полной квоты ({unit})', primary: 'Основная квота', secondary: 'Дополнительная квота',
  unavailable: 'Недостаточно данных',
  hint: 'Оценка полной и оставшейся квоты по расходу за последний период непрерывного снижения.',
  detail: 'Стоимость расхода делится на снижение квоты в процентных пунктах. '
    + 'При двух ограничениях выбирается меньшая доступная сумма.',
  signedOut: 'Войдите, чтобы увидеть расход на устройствах и оценку квоты.',
  ready: 'Расход официальных аккаунтов, записанный на устройствах.',
  unavailableStatus: 'Данные о расходе временно недоступны. Повторите попытку позже.',
  updated: 'Обновлено', empty: 'Нет данных о расходе',
};
export function officialUsageLabels(language: string, unit = 'USD'): Labels {
  const labels = language === 'zh' ? zh : language === 'ru' ? ru : en;
  return { ...labels, cost: labels.cost.replace('{unit}', () => unit),
    remaining: labels.remaining.replace('{unit}', () => unit), capacity: labels.capacity.replace('{unit}', () => unit) };
}
