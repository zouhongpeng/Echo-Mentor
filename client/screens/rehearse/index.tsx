import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { api } from '@/utils/api';
import { getDsKey, chatDirect } from '@/utils/deepseek';

interface RehearseProps {
  person_id: string;
  person_name?: string;
}

type Msg = { role: 'user' | 'ai'; text: string };

interface Feedback {
  score?: number;
  highlights?: string[];
  risks?: string[];
  tips?: string[];
}

/**
 * 模拟对话演练：AI 扮演对方，陪你把重要对话先练一遍
 * - AI 用人物档案 + 目标代入角色，口语化短句回复
 * - 随时可「复盘」：得分 + 亮点 + 风险 + 建议
 */
export default function RehearseScreen() {
  const params = useSafeSearchParams<RehearseProps>();
  const router = useSafeRouter();
  const personId = params.person_id;
  const personName = params.person_name || '对方';

  const [phase, setPhase] = useState<'setup' | 'chat'>('setup');
  const [goal, setGoal] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  if (!personId) return null;

  const start = () => {
    if (!goal.trim()) { Alert.alert('提示', '先写一句你想达成什么，如：为爽约道歉并约好下周时间'); return; }
    setPhase('chat');
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const history = [...messages, { role: 'user' as const, text }];
    setMessages(history);
    setInput('');
    setLoading(true);
    try {
      const dsKey = await getDsKey();
      let reply: string;
      if (dsKey) {
        reply = await chatDirect(dsKey, buildSystem(personName, goal), toChatMessages(history), 0.9);
      } else {
        const r = await api.rehearse({ person_id: personId, goal: goal.trim(), mode: 'chat', history });
        reply = r.reply;
      }
      setMessages([...history, { role: 'ai', text: reply }]);
    } catch (e: any) {
      Alert.alert('演练失败', e?.message || '请稍后再试');
    } finally {
      setLoading(false);
    }
  };

  const review = async () => {
    if (loading || reviewing) return;
    if (!messages.length) { Alert.alert('提示', '先练一两句再复盘'); return; }
    setReviewing(true);
    setFeedback(null);
    try {
      const dsKey = await getDsKey();
      const transcript = messages.map((m) => `${m.role === 'user' ? '我' : personName}：${m.text}`).join('\n');
      const system = `你是沟通教练。用户刚与「${personName}」完成一场模拟对话演练（你扮演了对方）。请复盘用户的表达，严格输出 JSON：
{"score":0-100,"highlights":["做得好的1-3条"],"risks":["风险/欠佳处1-3条"],"tips":["下次可尝试的具体说法1-3条"]}
要求：具体、引用原句片段、说人话无套话；score 综合清晰度/语气/目标接近程度。`;
      const user = `【演练目标】\n${goal.trim()}\n\n【对话实录】\n${transcript}`;
      if (dsKey) {
        const raw = await chatDirect(dsKey, system, [{ role: 'user', content: user }], 0.5);
        const parsed = extractJsonLoose(raw);
        if (parsed) { setFeedback(parsed); return; }
        throw new Error('无法解析复盘结果');
      }
      const r = await api.rehearse({ person_id: personId, goal: goal.trim(), mode: 'review', transcript });
      setFeedback(r.feedback || {});
    } catch (e: any) {
      Alert.alert('复盘失败', e?.message || '请稍后再试');
    } finally {
      setReviewing(false);
    }
  };

  const restart = () => {
    setMessages([]);
    setFeedback(null);
    setPhase('setup');
  };

  return (
    <Screen safeAreaEdges={['top', 'left', 'right', 'bottom']}>
      <View className="px-4 pt-2 pb-1 flex-row items-center justify-between">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="w-10 h-10 justify-center">
          <Text className="text-2xl text-foreground">‹</Text>
        </TouchableOpacity>
        <Text className="text-lg font-bold text-foreground">模拟演练 · {personName}</Text>
        <View style={{ width: 40 }} />
      </View>

      {phase === 'setup' ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 40 }}>
          <Text className="text-[17px] font-semibold text-foreground">这场对话，你想达成什么？</Text>
          <Text className="mt-2 text-[13px] text-muted leading-5">
            AI 会扮演「{personName}」陪你练。把最担心的情况都练到，正式开口就不慌了。
          </Text>
          <TextInput
            value={goal}
            onChangeText={setGoal}
            placeholder="例：为上次爽约道歉，并约好下周一起复习"
            placeholderTextColor="#9C9CA3"
            multiline
            className="mt-4 bg-white border border-[#E5E5EA] rounded-2xl px-4 py-3 text-[15px] text-foreground min-h-[100px]"
          />
          <TouchableOpacity onPress={start} className="mt-5 bg-accent rounded-2xl py-4 items-center">
            <Text className="text-white font-semibold text-base">开始演练</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
            <View className="items-center pb-3">
              <Text className="text-[11px] text-[#9C9C9C]">目标：{goal.trim()}</Text>
            </View>
            {messages.map((m, i) => {
              const mine = m.role === 'user';
              return (
                <View key={i} className={`flex-row items-start mb-3 ${mine ? 'justify-end' : ''}`}>
                  {!mine && (
                    <View style={{ width: 34, height: 34, borderRadius: 6, backgroundColor: '#7A9BCE', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                      <Text className="text-white font-semibold text-[13px]">{personName.charAt(0) || 'TA'}</Text>
                    </View>
                  )}
                  <View style={{ backgroundColor: mine ? '#95EC69' : '#FFFFFF', borderWidth: 1, borderColor: mine ? '#86DB5B' : '#E5E5EA', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '74%' }}>
                    <Text className="text-[14px] leading-5" style={{ color: '#111111' }}>{m.text}</Text>
                  </View>
                  {mine && (
                    <View style={{ width: 34, height: 34, borderRadius: 6, backgroundColor: '#FF7A5C', alignItems: 'center', justifyContent: 'center', marginLeft: 8 }}>
                      <Text className="text-white font-semibold text-[13px]">我</Text>
                    </View>
                  )}
                </View>
              );
            })}
            {loading && (
              <View className="flex-row items-center pl-2 pb-2">
                <ActivityIndicator size="small" color="#7A9BCE" />
                <Text className="ml-2 text-[12px] text-muted">{personName}正在回复…</Text>
              </View>
            )}
            {feedback && (
              <View className="rounded-2xl bg-white border border-[#E5E5EA] p-4 mb-3">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-[14px] font-semibold text-foreground">演练复盘</Text>
                  <View className="px-2.5 py-1 rounded-full bg-accent/10">
                    <Text className="text-[13px] font-bold text-accent">{feedback.score ?? '-'} 分</Text>
                  </View>
                </View>
                {!!feedback.highlights?.length && (
                  <View className="mb-2">
                    <Text className="text-[12px] font-semibold text-[#3E8E41] mb-0.5">做得好</Text>
                    {feedback.highlights.map((h, i) => <Text key={i} className="text-[12.5px] leading-5 text-foreground/85">· {h}</Text>)}
                  </View>
                )}
                {!!feedback.risks?.length && (
                  <View className="mb-2">
                    <Text className="text-[12px] font-semibold text-danger mb-0.5">注意</Text>
                    {feedback.risks.map((h, i) => <Text key={i} className="text-[12.5px] leading-5 text-foreground/85">· {h}</Text>)}
                  </View>
                )}
                {!!feedback.tips?.length && (
                  <View>
                    <Text className="text-[12px] font-semibold text-accent mb-0.5">下次可以试试</Text>
                    {feedback.tips.map((h, i) => <Text key={i} className="text-[12.5px] leading-5 text-foreground/85">· {h}</Text>)}
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          <View className="px-4 pb-2 pt-1 border-t border-[#ECECEC] bg-white/95">
            <View className="flex-row items-center gap-2 py-2">
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={`说给「${personName}」听…`}
                placeholderTextColor="#9C9CA3"
                className="flex-1 bg-[#F2F2F7] rounded-full px-4 h-11 text-[15px] text-foreground"
                onSubmitEditing={send}
              />
              <TouchableOpacity onPress={send} disabled={loading} className="w-11 h-11 rounded-full bg-accent items-center justify-center">
                {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text className="text-white text-[16px] font-bold">↑</Text>}
              </TouchableOpacity>
            </View>
            <View className="flex-row items-center justify-between pb-2">
              <TouchableOpacity onPress={restart} hitSlop={6}>
                <Text className="text-[12px] text-muted">🔄 换个目标重练</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={review} disabled={reviewing} hitSlop={6}>
                {reviewing ? <ActivityIndicator size="small" color="#E4572E" /> : <Text className="text-[13px] text-accent font-semibold">📋 让教练复盘</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

function buildSystem(personName: string, goal: string): string {
  return `你正在一场「模拟对话演练」中扮演「${personName}」，与用户练习一段真实对话。
用户的演练目标：${goal}
扮演要求：
1. 完全以 ${personName} 的第一人称说话，不要出戏、不要给建议、不要提到自己在扮演；
2. 语气口语化、贴合真实聊天（可带一点情绪和口头禅），每次回复 ≤ 60 字，通常 1-2 句；
3. 适度设置障碍：可以追问、表达不满、犹豫——让练习真实有挑战，但不要人身攻击；
4. 用户表达真诚且切中要害时，适当缓和态度。`;
}

function toChatMessages(history: Msg[]) {
  return history.map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), content: m.text }));
}

function extractJsonLoose(text: string): Feedback | null {
  const t = text.trim().replace(/```json|```/g, '');
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}
