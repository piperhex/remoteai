import type { LocalMappingAliases } from '../../../../../../shared/port-mapping/localAliases';
import type { ForwardingEntry, PortForwardingService } from './service';

interface MappingEditor {
  service: PortForwardingService;
  aliases: LocalMappingAliases;
  entry?: ForwardingEntry;
}
type MappingTarget = Parameters<PortForwardingService['save']>[0];

export async function saveMappingDraft({ service, aliases, entry }: MappingEditor, target: MappingTarget, alias: string) {
  if (!entry) {
    const id = service.save(target);
    try { aliases.set(id, alias); }
    catch (error) {
      await service.remove(id);
      throw error;
    }
    return id;
  }

  const previousAlias = aliases.get(entry.id);
  aliases.set(entry.id, alias);
  // A local rename should not update the synchronized configuration or disturb an active tunnel.
  if (target.remoteHost === (entry.remoteHost ?? '') && target.remotePort === entry.remotePort
    && target.localPort === entry.localPort && target.protocol === (entry.protocol ?? 'tcp')
    && target.localDomain === (entry.localDomain ?? '')
    && (target.linkProtocol ?? 'http') === (entry.linkProtocol ?? 'http')) return entry.id;

  try { await service.edit(entry.id, target); }
  catch (error) {
    aliases.set(entry.id, previousAlias);
    throw error;
  }
  return entry.id;
}
