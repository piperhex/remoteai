import { useState } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { agreementCopy, getUserAgreement } from '../../../../shared/legal/agreement';
import type { AgreementConsent as Consent } from '../../../../shared/legal/useAgreementConsent';
import { useStyles } from './agreementStyles';
import { useLanguage } from '../i18n';

export function AgreementConsent({ consent, disabled }: { consent: Consent; disabled: boolean }) {
  const styles = useStyles();
  const language = useLanguage();
  const copy = agreementCopy[language];
  const agreement = getUserAgreement(language);
  const [reading, setReading] = useState(false);
  const close = () => reading ? setReading(false) : consent.cancel();
  const read = () => { Keyboard.dismiss(); setReading(true); };

  return <>
    <View style={styles.checkRow}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent.accepted, disabled }}
        accessibilityLabel={copy.checkbox} disabled={disabled} style={styles.checkLabel}
        onPress={() => consent.setAccepted(!consent.accepted)}>
        <View style={[styles.checkbox, consent.accepted && styles.checked]}>
          {consent.accepted && <Text style={styles.tick}>✓</Text>}
        </View>
        <Text style={styles.checkText}>{copy.prefix}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={read} style={styles.linkButton}>
        <Text style={styles.link}>{copy.link}</Text>
      </Pressable>
    </View>
    <Modal transparent visible={reading || consent.pendingAction !== null} animationType="fade"
      onShow={Keyboard.dismiss} onRequestClose={close}>
      <SafeAreaView style={styles.overlay}>
        <View accessibilityViewIsModal style={[styles.card, reading && styles.reader]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>{reading ? agreement.title : copy.title}</Text>
            {reading && <Pressable accessibilityRole="button" accessibilityLabel={copy.close}
              onPress={close} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>}
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            {reading ? <>
              <Text style={styles.updated}>{agreement.updated}</Text>
              <Text selectable style={styles.paragraph}>{agreement.introduction}</Text>
              {agreement.sections.map(section => <View key={section.title}>
                <Text accessibilityRole="header" style={[styles.sectionTitle, section.important && styles.important]}>
                  {section.title}
                </Text>
                {section.paragraphs.map(paragraph => <Text selectable key={paragraph} style={styles.paragraph}>
                  {paragraph}
                </Text>)}
              </View>)}
            </> : <>
              <Text style={styles.paragraph}>{consent.pendingAction === 'register' ? copy.register : copy.login}</Text>
              <Pressable accessibilityRole="button" onPress={read} style={styles.linkButton}>
                <Text style={styles.link}>{copy.link}</Text>
              </Pressable>
            </>}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={close} style={styles.action}>
              <Text style={styles.actionText}>{reading ? copy.close : copy.cancel}</Text>
            </Pressable>
            {!reading && <Pressable accessibilityRole="button" onPress={() => void consent.confirm()}
              style={[styles.action, styles.primaryAction]}>
              <Text style={[styles.actionText, styles.primaryText]}>
                {consent.pendingAction === 'register' ? copy.confirmRegister : copy.confirmLogin}
              </Text>
            </Pressable>}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}
