import type { Language } from "../../i18n";

const labels = {
  zh: {
    today: "今日消耗", noData: "暂无数据", details: "查看用量详情", used: "已使用", disabled: "已禁用",
    remaining: "剩余额度", countdown: "剩余 {time}",
    hint: "百分比表示当前剩余额度，用量会在重置时间恢复。",
  },
  en: {
    today: "Today", noData: "No data yet", details: "View usage details", used: "Used", disabled: "Disabled",
    remaining: "Remaining quota", countdown: "{time} left",
    hint: "The percentage shows your remaining quota. Usage resets at the time shown.",
  },
  ru: {
    today: "Сегодня", noData: "Пока нет данных", details: "Подробнее о расходе", used: "Использовано",
    disabled: "Отключён",
    remaining: "Остаток квоты", countdown: "Осталось {time}",
    hint: "Процент показывает остаток квоты. Расход сбрасывается в указанное время.",
  },
};

export function accountCardLabels(language: Language) {
  return labels[language];
}
