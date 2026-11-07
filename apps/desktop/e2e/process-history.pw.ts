import { processHistoryChecks } from './process-history-checks';
import { processHistoryMergeChecks } from './process-history-merge-checks';
import { commandGroupHistoryChecks } from './command-group-history-checks';

processHistoryChecks(['local', 'remote']);
processHistoryMergeChecks(['local', 'remote']);
commandGroupHistoryChecks(['local', 'remote']);
