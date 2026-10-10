import { invoke } from "./backend";

export interface ComputerUsePermissions {
  accessibility: boolean;
  screenRecording: boolean;
  restartRequired?: ComputerUsePermission[];
}

export type ComputerUsePermission = 'accessibility' | 'screenRecording';

export interface ComputerUseStatus {
  installed: boolean;
  enabled: boolean;
  needsRepair: boolean;
  supported: boolean;
  version: string;
  permissions: ComputerUsePermissions | null;
}

export type ComputerUseAction = "install" | "enable" | "disable" | "remove";

export function computerUseStatus(homeId: string) {
  return invoke<ComputerUseStatus>("computer_use_status", { homeId });
}

export function computerUseAction(homeId: string, action: ComputerUseAction) {
  return invoke<ComputerUseStatus>("computer_use_action", { homeId, action });
}

export function requestComputerUsePermission(permission: ComputerUsePermission) {
  return invoke<void>("computer_use_request_permission", { permission });
}
