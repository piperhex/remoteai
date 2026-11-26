import { ComputerIdentity } from '../../../../../shared/remote-chat/ComputerIdentity';
import type { ChatComputer } from '../../../../../shared/remote-chat/devices';

interface ComputerOption { label: string; value: string; device?: ChatComputer }

export function mappingComputerOption({ device }: { device: ChatComputer }): ComputerOption {
  return { label: device.name, value: device.deviceId, device };
}

export function mappingComputerLabel(device: ChatComputer) {
  return <ComputerIdentity name={device.name} device={device} />;
}

export function renderComputerOption({ data }: { data: ComputerOption }) {
  return data.device ? mappingComputerLabel(data.device) : data.label;
}
