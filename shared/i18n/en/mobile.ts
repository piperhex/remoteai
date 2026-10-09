import { mobile1 } from './mobile1';
import { mobile2 } from './mobile2';
import { mobile3 } from './mobile3';
import { mobile4 } from './mobile4';
import { mobile5 } from './mobile5';
import { mobile6 } from './mobile6';

export const mobile = {
  '首 token 等待时间': 'Time to first token',
  '当前对话的平均首 token 等待时间：从请求发出到收到首段文字、思考或工具参数。仅统计已收到输出的流式请求。':
    'Average time from sending a request to receiving the first text, reasoning or tool argument in this conversation. ' +
    'Includes streaming requests with observed output.',
  '对话输出速度': 'Conversation output speed',
  '当前对话的平均输出速度：已完成请求的输出 token 数 ÷ 输出耗时，不含首次响应前的等待和中断请求。':
    'Average output speed for this conversation: output tokens divided by output time across completed requests, ' +
    'excluding the wait for the first response and interrupted requests.',
  ...mobile1, ...mobile2, ...mobile3, ...mobile4, ...mobile5, ...mobile6,
};
