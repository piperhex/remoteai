import { messages } from './messages';
import { terminalMessages } from './terminal';
import { gitMessages } from './git';
import { remoteDesktopMessages } from './remoteDesktop';
import { mobile } from './mobile';
import { reliabilityEnglish } from '../chatReliability';
import { reviewEnglish } from '../taskReview';
import { cliImportEnglish } from '../cliImport';

export const english: Readonly<Record<string, string>> = {
  ...messages, ...terminalMessages, ...gitMessages, ...remoteDesktopMessages, ...mobile,
  ...reliabilityEnglish,
  ...reviewEnglish,
  ...cliImportEnglish,
};
