import { uiText } from "../../../../../../shared/localization/uiText";
import type { TaskInput } from "./types";

export const TASK_SUGGESTIONS: (TaskInput & { description: string; icon: "briefing" | "review" | "monitor" })[] = [
  { get title() { return uiText("client.scheduledTasks.dailyBriefing"); }, get description() { return uiText("client.scheduledTasks.startEachWeekdayWithASummaryOfYourCalendarUnread"); }, icon: "briefing",
    get prompt() { return uiText("client.scheduledTasks.prepareTodaySBriefingUsingTheAvailableCalendarUnreadEmails"); },
    cwd: "", schedule: { kind: "weekdays", time: "08:00" } },
  { get title() { return uiText("client.scheduledTasks.weeklyReview"); }, get description() { return uiText("client.scheduledTasks.turnYourRecentWorkIntoAConciseStatusUpdateEvery"); }, icon: "review",
    get prompt() { return uiText("client.scheduledTasks.reviewThisWeekSWorkAndWriteAConciseStatus"); },
    cwd: "", schedule: { kind: "weekly", time: "16:00", weekday: 4 } },
  { get title() { return uiText("client.scheduledTasks.followUpMonitor"); }, get description() { return uiText("client.scheduledTasks.reviewRecentEmailsAndCalendarEventsAndFlagItemsThat"); }, icon: "monitor",
    get prompt() { return uiText("client.scheduledTasks.reviewAvailableRecentEmailsAndCalendarEventsListUnansweredMessages"); },
    cwd: "", schedule: { kind: "weekdays", time: "09:00" } },
];
