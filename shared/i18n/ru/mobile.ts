import { mobile1 } from './mobile1';
import { mobile2 } from './mobile2';
import { mobile3 } from './mobile3';
import { mobile4 } from './mobile4';
import { mobile5 } from './mobile5';

export const mobile = {
  '对话输出速度': 'Скорость вывода в чате',
  '当前对话的平均输出速度：已完成请求的输出 token 数 ÷ 输出耗时，不含首次响应前的等待和中断请求。':
    'Средняя скорость вывода в этом чате: выходные токены за время вывода завершённых запросов, ' +
    'без ожидания первого ответа и прерванных запросов.',
  ...mobile1, ...mobile2, ...mobile3, ...mobile4, ...mobile5,
};
