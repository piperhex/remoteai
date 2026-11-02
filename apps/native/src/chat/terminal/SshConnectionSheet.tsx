import { SheetGestureScrollView as ScrollView } from '../../components/SheetScrollGesture';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { SshApi } from '../../../../../shared/terminal/ssh';
import type { TerminalInfo } from '../../../../../shared/terminal/types';
import { sshLabel, type SshProfile } from '../../../../../shared/terminal/sshProfiles';
import { newSshValues, useSshConnection, type SshValues } from '../../../../../shared/terminal/useSshConnection';
import { validSshSettings } from '../../../../../shared/terminal/sshConnectionValues';
import { BottomSheet } from '../../components/BottomSheet';
import { t, displayError, useLanguage } from '../../i18n';
import { useSshStyles } from './sshStyles';
import { SshButton, SshField } from './SshControls';
import { SshHostKeySheet } from './SshHostKeySheet';

export function SshConnectionSheet({ api, cwd, connected, dispose, close, initial, settingsOnly = false }: {
  api: SshApi; cwd: string; connected: (info: TerminalInfo) => void;
  dispose: (id: string) => Promise<void>; close: () => void;
  initial?: SshProfile; settingsOnly?: boolean;
}) {
  useLanguage();
  const styles = useSshStyles();
  const [values, setValues] = useState<SshValues>(() => initial ?? newSshValues());
  const connection = useSshConnection({ api, initial, projectCwd: cwd, connected, dispose, close, createId: randomUUID });
  const { busy, finished, loading } = connection;
  const disabled = busy || finished || loading;
  const choose = (profile?: SshProfile) => setValues(connection.choose(profile));
  const set = (key: keyof typeof values, value: string | number) => {
    if (key === 'host' || key === 'port') connection.clearTrust();
    setValues(previous => ({ ...previous, [key]: value }));
  };
  useEffect(() => { if (finished) setValues(newSshValues()); }, [finished]);
  const settingsTitle = initial ? 'client.ssh.editTitle' : 'client.ssh.createTitle';
  const title = settingsOnly ? settingsTitle : 'client.ssh.connection';
  const saveAction = { label: t('client.ssh.saveSettings'), onPress: () => connection.saveSettings(values),
    loading: busy, disabled: disabled || !validSshSettings(values) };
  return <BottomSheet visible title={t(title)} onClose={close} dismissible={!busy}
    tall maxWidth={400} actions={finished ? [] : settingsOnly ? [saveAction] : [{
      label: t(connection.trust ? 'client.ssh.trustAndConnect' : 'client.ssh.connect'),
      onPress: () => connection.submit(values), loading: busy,
      disabled: disabled || !connection.canConnect(values),
    }]}>
    {settingsOnly && !!connection.error && <View style={styles.content}>
      <Text accessibilityRole="alert" style={styles.error}>{displayError(connection.error)}</Text>
      <SshButton label={t('client.ssh.refresh')} disabled={busy || loading}
        onPress={() => void connection.refresh()} />
    </View>}
    <ScrollView showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!settingsOnly && <><View style={styles.row}>
        <SshButton label={t('client.ssh.new')} disabled={disabled} onPress={() => choose()} />
        <SshButton label={t('client.ssh.refresh')} disabled={busy || loading}
          onPress={() => void connection.refresh()} />
      </View>
      <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}
        style={styles.list} contentContainerStyle={styles.content}>
        {connection.profiles.map(profile => <SshButton key={profile.id} label={profile.name || sshLabel(profile)}
          selected={connection.selected?.id === profile.id} disabled={disabled} onPress={() => choose(profile)} />)}
      </ScrollView>
      {connection.selected && <SshButton label={t('client.ssh.removeSaved')} disabled={disabled}
        onPress={() => void connection.remove().then(done => { if (done) setValues(newSshValues()); })} />}</>}
      {loading && <ActivityIndicator />}
      {settingsOnly && <Text style={styles.hint}>{t('client.ssh.settingsCredentialsHint')}</Text>}
      <SshField label={t('client.ssh.name')} value={values.name} maxLength={80} editable={!disabled}
        onChangeText={value => set('name', value)} />
      <SshField label={t('client.ssh.host')} value={values.host} maxLength={253} editable={!disabled}
        onChangeText={value => set('host', value)} />
      <SshField label={t('client.ssh.port')} value={values.port ? String(values.port) : ''} maxLength={5}
        keyboardType="number-pad" editable={!disabled} onChangeText={value => set('port', Number(value))} />
      <SshField label={t('client.ssh.username')} value={values.username} maxLength={256} editable={!disabled}
        onChangeText={value => set('username', value)} />
      <Text style={styles.label}>{t('client.ssh.authentication')}</Text>
      <View style={styles.row}>
        <SshButton label={t('client.ssh.password')} disabled={disabled} selected={values.auth === 'password'}
          onPress={() => set('auth', 'password')} />
        <SshButton label={t('client.ssh.privateKey')} disabled={disabled} selected={values.auth === 'key'}
          onPress={() => set('auth', 'key')} />
      </View>
      {values.auth === 'key' ? <>
        <SshField label={t('client.ssh.privateKey')} value={values.privateKey ?? ''} multiline maxLength={65536}
          editable={!disabled} onChangeText={value => set('privateKey', value)} />
        <SshField label={t('client.ssh.passphrase')} value={values.passphrase ?? ''} secureTextEntry maxLength={4096}
          editable={!disabled} onChangeText={value => set('passphrase', value)} />
      </> : <SshField label={t('client.ssh.password')} value={values.password ?? ''} secureTextEntry maxLength={4096}
        editable={!disabled} onChangeText={value => set('password', value)} />}
      <Text style={styles.hint}>{t('client.ssh.credentialsHint')}</Text>
      {connection.trust && !connection.trust.previousFingerprints && <View>
        <Text style={styles.label}>{t('client.ssh.trustHost')}</Text>
        <Text selectable style={styles.hint}>{connection.trust.fingerprint}</Text></View>}
      {!settingsOnly && !!connection.error && <Text accessibilityRole="alert" style={styles.error}>
        {displayError(connection.error)}</Text>}
    </ScrollView>
    <SshHostKeySheet connection={connection} />
  </BottomSheet>;
}
