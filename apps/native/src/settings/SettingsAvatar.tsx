import { useState, useSyncExternalStore } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { LoungeController } from '../../../../shared/lounge/controller';
import { accountName } from '../../../../shared/lounge/names';
import { initials } from '../../../../shared/lounge/types';
import { LoungeAvatarSettings } from '../lounge/LoungeDialogs';
import { t } from '../i18n';
import { useStyles } from './styles';

export function SettingsAvatar({ controller, account }: { controller: LoungeController; account: string }) {
  const styles = useStyles();
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const [editing, setEditing] = useState<LoungeController>();
  const [failedSource, setFailedSource] = useState<string>();
  const user = state.user ?? { id: '', account };
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={t('client.lounge.editAvatar')}
      onPress={() => setEditing(controller)} style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}>
      {user.avatar && failedSource !== user.avatar
        ? <Image source={{ uri: user.avatar }} style={styles.avatar} onError={() => setFailedSource(user.avatar)} />
        : <View style={styles.avatarCenter}>
          <Text style={styles.avatarText}>{initials(accountName(user))}</Text>
        </View>}
    </Pressable>
    {editing === controller && <LoungeAvatarSettings key={user.id || account} user={user}
      controller={controller} close={() => setEditing(undefined)} />}
  </>;
}
