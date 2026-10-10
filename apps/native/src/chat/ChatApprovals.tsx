import { createThemedStyles } from '../theme/styles';
import { useThemeColor } from '../theme/store';
import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ApprovalReply, GuiEvent } from './types';
import type { Question } from '../../../desktop/src/pages/codexGui/types';
import { palette, useStyles } from './styles';
import { useApprovalResponse } from './useApprovalResponse';

function ApprovalCode({ text }: { text: string }) {
  const approvalStyles = useApprovalStyles();
  const styles = useStyles();
  useLanguage();
  return <ScrollView nestedScrollEnabled style={approvalStyles.codeBox}>
    <Text selectable style={[styles.code, approvalStyles.codeText]}>{text}</Text>
  </ScrollView>;
}

function PermissionDetails({ event }: { event: GuiEvent }) {
  const approvalStyles = useApprovalStyles();
  useLanguage();
  if (event.method !== 'item/permissions/requestApproval') return null;
  const permissions = event.params.permissions;
  return <View style={approvalStyles.permissions}>
    {permissions?.network?.enabled && <Text style={approvalStyles.body}>{t("访问网络")}</Text>}
    {permissions?.fileSystem?.read?.map((path) =>
      <Text selectable key={path} style={approvalStyles.body}>{t("读取：")}{path}</Text>)}
    {permissions?.fileSystem?.write?.map((path) =>
      <Text selectable key={path} style={approvalStyles.body}>{t("编辑：")}{path}</Text>)}
    {permissions?.fileSystem?.entries && <ApprovalCode
      text={JSON.stringify(permissions.fileSystem.entries, null, 2)} />}
  </View>;
}

interface QuestionProps { question: Question; value: string; busy: boolean;
  update: (value: string) => void; submit: () => void }

function ApprovalQuestion({ question, value, busy, update, submit }: QuestionProps) {
  const resolveThemeColor = useThemeColor();
  const approvalStyles = useApprovalStyles();
  const styles = useStyles();
  const color = useThemeColor();
  useLanguage();
  return <View style={approvalStyles.question}>
    <Text style={styles.messageText}>{question.question}</Text>
    {question.options?.map((option) => <Pressable key={option.label} accessibilityRole="radio" disabled={busy}
      accessibilityState={{ checked: value === option.label, disabled: busy }}
      style={[approvalStyles.option, busy && styles.disabled]} onPress={() => update(option.label)}>
      <Ionicons name={value === option.label ? 'radio-button-on' : 'radio-button-off'} size={18}
        color={value === option.label ? resolveThemeColor(palette.green, 'accent') : resolveThemeColor(palette.muted, 'muted')} />
      <View style={styles.fill}><Text style={approvalStyles.body}>{option.label}</Text>
        {!!option.description && <Text style={styles.subtitle}>{option.description}</Text>}</View>
    </Pressable>)}
    <TextInput accessibilityLabel={question.question} style={[styles.questionInput, busy && styles.disabled]}
      placeholder={t("输入你的回答")} placeholderTextColor={color(palette.muted, 'muted')} editable={!busy}
      secureTextEntry={question.isSecret} value={value} onChangeText={update} returnKeyType="send"
      onSubmitEditing={submit} />
  </View>;
}

interface ApprovalProps { event: GuiEvent; respond: (reply: ApprovalReply) => Promise<void> }

export function ChatApproval({ event, respond }: ApprovalProps) {
  const styles = useStyles();
  const approvalStyles = useApprovalStyles();
  const color = useThemeColor();
  useLanguage();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const { busy, error, send } = useApprovalResponse({ event, answers, respond });
  if (event.id == null) return null;
  const { params, method } = event;
  const questions = params.questions ?? [];
  const isQuestion = method === 'item/tool/requestUserInput';
  const incomplete = isQuestion && questions.some((question) => !answers[question.id]?.trim());
  const submit = () => { void send('accept'); };
  return <View style={[styles.approval, approvalStyles.card]} accessibilityState={{ busy }}>
    <View style={styles.row}><Ionicons name="shield-outline" size={17} color={color(palette.ink, 'ink')} />
      <Text style={approvalStyles.title}>{isQuestion ? t("需要你的补充") : t("需要你的确认")}</Text></View>
    {!!params.reason && <Text style={approvalStyles.body}>{params.reason}</Text>}
    {!!params.command && <ApprovalCode text={params.command} />}
    {!!(params.cwd || params.grantRoot) && <Text selectable style={styles.subtitle}>
      {params.cwd || params.grantRoot}</Text>}
    <PermissionDetails event={event} />
    {questions.map((question) => <ApprovalQuestion key={question.id} question={question}
      value={answers[question.id] ?? ''} busy={busy} submit={submit}
      update={(answer) => setAnswers((current) => ({ ...current, [question.id]: answer }))} />)}
    {!!error && <Text accessibilityRole="alert" style={approvalStyles.error}>{error}</Text>}
    <View style={styles.row}>
      {(isQuestion || !params.availableDecisions || params.availableDecisions.includes('accept')) &&
        <Pressable accessibilityRole="button" disabled={busy || incomplete}
          accessibilityState={{ disabled: busy || incomplete, busy }} onPress={submit}
          style={[styles.button, styles.primary, approvalStyles.action, (busy || incomplete) && styles.disabled]}>
          {busy && <ActivityIndicator size="small" color="#fff" />}
          <Text style={[styles.buttonText, styles.primaryText]}>{isQuestion ? t("提交回答") : t("允许这一次")}</Text>
        </Pressable>}
      {!isQuestion && <Pressable accessibilityRole="button" disabled={busy}
        accessibilityState={{ disabled: busy }} style={[styles.button, approvalStyles.decline, busy && styles.disabled]}
        onPress={() => { void send(params.availableDecisions?.includes('decline') === false ? 'cancel' : 'decline'); }}>
        <Text style={approvalStyles.body}>{t("拒绝")}</Text>
      </Pressable>}
    </View>
  </View>;
}

const useApprovalStyles = createThemedStyles((color) => ({
  card: { backgroundColor: color('#fff', 'surface'), borderColor: color('#e4c993', 'border'), borderRadius: 12, padding: 16 },
  title: { color: color(palette.ink, 'ink'), fontWeight: '700', fontSize: 13, lineHeight: 20 },
  body: { color: color(palette.ink, 'ink'), fontSize: 12, lineHeight: 20 },
  codeBox: { maxHeight: 180, padding: 10, borderRadius: 8, backgroundColor: color('#f5f7f6', 'canvas') },
  codeText: { fontSize: 11, lineHeight: 18 },
  question: { gap: 10, paddingTop: 4 },
  option: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  permissions: { gap: 8 },
  action: { flexDirection: 'row', gap: 6 },
  decline: { borderWidth: 1, borderColor: color(palette.border, 'border'), backgroundColor: color('#fff', 'surface') },
  error: { maxWidth: 400, color: color(palette.danger, 'danger'), fontSize: 12, lineHeight: 20 },
}));
