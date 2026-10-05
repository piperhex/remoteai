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

export const russian = {
  ...downloads,
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
