import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { accountName } from '../../../../shared/lounge/names';
import { initials } from '../../../../shared/lounge/types';
import type { LoungeController } from '../../../../shared/lounge/controller';
import type { LoungeReply } from '../../../../shared/lounge/reply';
import { invoke, isDesktopApp } from '../api/backend';
import type { TrayMessages, TraySender } from './trayMessages';

export const hasLoungeTray = isDesktopApp && /Windows/i.test(globalThis.navigator?.userAgent ?? '');

function fallbackAvatar(name: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.fillStyle = '#246c66';
  context.fillRect(0, 0, 32, 32);
  context.fillStyle = '#fff';
  context.font = '600 13px "Segoe UI", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(initials(name), 16, 16, 28);
  return canvas.toDataURL('image/png');
}

function trayMessages(controller: LoungeController, cachedAvatars: Map<string, string | undefined>): TrayMessages {
  const { contacts } = controller.snapshot();
  const peers = new Map(contacts.map(({ user }) => [user.id, user]));
  const senders = new Map<string, TraySender>();
  const messages = controller.unreadDirectNotifications().map(({ key, reference, sentAt }) => {
    const peer = peers.get(reference.senderId);
    if (!senders.has(reference.senderId)) {
      const name = peer ? accountName(peer) : reference.account;
      if (!peer?.avatar && !cachedAvatars.has(name)) cachedAvatars.set(name, fallbackAvatar(name));
      senders.set(reference.senderId, { name, avatar: peer?.avatar || cachedAvatars.get(name) });
    }
    const { senderId, text, imageCount } = reference;
    return { key, senderId, sentAt, text: text.replace(/\s+/g, ' ').trim(), imageCount };
  });
  return { messages, senders: Object.fromEntries(senders) };
}

export function useLoungeTray(controller: LoungeController, openLounge: (target?: LoungeReply) => void) {
  const delivery = useRef<{ last?: string; pending?: TrayMessages; running: boolean }>({ running: false });
  useEffect(() => {
    if (!hasLoungeTray) return;
    let disposed = false;
    const queue = delivery.current;
    let cachedAvatars = new Map<string, string | undefined>();
    let previousEntries: ReturnType<LoungeController['unreadDirectNotifications']> | undefined;
    let previousContacts: ReturnType<LoungeController['snapshot']>['contacts'] | undefined;
    const flush = async () => {
      if (queue.running) return;
      queue.running = true;
      try {
        while (queue.pending) {
          const next = queue.pending;
          queue.pending = undefined;
          await invoke('lounge_tray_update', { messages: next });
        }
      } catch (error) {
        queue.last = undefined;
        console.error('Could not update the lounge tray', error);
      } finally {
        queue.running = false;
        if (queue.pending) void flush();
      }
    };
    const update = () => {
      const entries = controller.unreadDirectNotifications();
      const { contacts } = controller.snapshot();
      if (entries === previousEntries && (contacts === previousContacts || !entries.length) && queue.last) return;
      previousEntries = entries;
      previousContacts = contacts;
      const next = trayMessages(controller, cachedAvatars);
      cachedAvatars = new Map(Object.values(next.senders)
        .filter(({ name }) => cachedAvatars.has(name)).map(({ name }) => [name, cachedAvatars.get(name)]));
      const signature = JSON.stringify(next);
      if (signature === queue.last) return;
      queue.last = signature;
      queue.pending = next;
      void flush();
    };
    const unsubscribe = controller.subscribe(update);
    const subscription = listen<string | null>('lounge-tray-navigate', ({ payload }) => {
      if (disposed) return;
      const entry = payload && controller.unreadDirectNotifications().find(message => message.key === payload);
      if (entry) {
        const { reference } = entry;
        const peer = controller.snapshot().contacts.find(({ user }) => user.id === reference.senderId)?.user;
        controller.selectConversation(peer ?? { id: reference.senderId, account: reference.account });
        openLounge({ ...reference });
      } else openLounge();
    });
    void subscription.catch(console.error);
    update();
    return () => {
      disposed = true;
      unsubscribe();
      void subscription.then(remove => remove()).catch(console.error);
    };
  }, [controller, openLounge]);
}
