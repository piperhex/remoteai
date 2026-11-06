import { processHistoryChecks } from './process-history-checks';
import { processHistoryMergeChecks } from './process-history-merge-checks';

processHistoryChecks(['local', 'remote']);
processHistoryMergeChecks(['local', 'remote']);
