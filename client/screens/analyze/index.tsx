import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView, Alert, ActivityIndicator, Platform, Modal, StyleSheet, Animated,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MeAvatar from '@/components/MeAvatar';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { api } from '@/utils/api';
import { createFormDataFile } from '@/utils';
import { findMethodByTitle } from '@/constants/methodologies';
import { getDsKey, analyzeDirect, analyzeDirectStream, progressiveExtract, saveComputedBestEffort } from '@/utils/deepseek';

interface AnalyzeProps {
  person_id: string;
  person_name?: string;
  prefill_note?: string;
}

const TEMP_COLOR: Record<string, string> = { 热: '#E4572E', 温: '#C9A227', 冷: '#7A9BCE' };
const ANALYZE_STAGES = ['正在阅读聊天记录…', '分析对方心理…', '生成建议回复…', '核对注意事项与温度…'];

/**
 * 核心分析页
 * - 双输入：聊天记录 + 我的想法
 * - 截图输入（识别后回填可编辑）
 * - 输出三段：对面在想什么 / 建议回复 / 注意事项 + 关系温度
 */
export default function AnalyzeScreen() {
  const params = useSafeSearchParams<AnalyzeProps>();
  const router = useSafeRouter();
  const personId = params.person_id;
  const personName = params.person_name || '对方';

  const [chatInput, setChatInput] = useState('');
  const [thoughtInput, setThoughtInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [moderated, setModerated] = useState(false);
  const [pollTimer, setPollTimer] = useState<any>(null);
  const [marks, setMarks] = useState<Record<string, boolean>>({});

  // 流式输出 + 阶段进度
  const [streamText, setStreamText] = useState('');
  const [ghost, setGhost] = useState<{ thoughts: string[]; suggestions: string[] }>({ thoughts: [], suggestions: [] });
  const [stageIdx, setStageIdx] = useState(0);
  const tones = ['正式', '日常', '熟昵'] as const;
  const [btnState, setBtnState] = useState<'idle' | 'loading' | 'success'>('idle');
  const [tone, setTone] = useState<'正式' | '日常' | '熟昵'>('日常');
  // 快记预填「我的想法」
  useEffect(() => {
    if (params.prefill_note) setThoughtInput(params.prefill_note);
  }, [params.prefill_note]);

  useEffect(() => {
    if (!loading) { setStageIdx(0); return; }
    const iv = setInterval(() => setStageIdx((i) => Math.min(i + 1, ANALYZE_STAGES.length - 1)), 6000);
    return () => clearInterval(iv);
  }, [loading]);

  // 风格学习：收集该人物过往「标记用了」的回复 + 最近的想法
  const gatherStyleExamples = async (): Promise<string[] | undefined> => {
    try {
      if (!personId) return undefined;
      const list = await api.personAnalyses(personId);
      const out: string[] = [];
      for (const r of list || []) {
        const res = r.result || {};
        const mk = res.marks || {};
        (res.suggestions || []).forEach((s: any, i: number) => {
          if (mk[String(i)] && s?.text) out.push(s.text);
        });
      }
      (list || []).slice(0, 3).forEach((r: any) => { if (r.thought_input) out.push(r.thought_input); });
      try {
        const favs = JSON.parse((await AsyncStorage.getItem('echo_mentor_fav_phrases')) || '[]');
        favs.slice(0, 5).forEach((f: string) => out.unshift(`（常用语）${f}`));
      } catch { /* ignore */ }
      return out.length ? out.slice(0, 10) : undefined;
    } catch { return undefined; }
  };

  // 对话输入模式：bubble=逐句标说话人（支持多段落/多天合并）/ paste=整段粘贴（推荐，配 AI 分句）
  const [inputMode, setInputMode] = useState<'bubble' | 'paste'>('paste');
  type Msg = { speaker: 'me' | 'them'; text: string };
  const [segments, setSegments] = useState<{ date: string; items: Msg[] }[]>([
    { date: '', items: [{ speaker: 'them', text: '' }, { speaker: 'me', text: '' }] },
  ]);
  const buildMsgText = () =>
    segments
      .map((seg, si) => {
        const lines = seg.items
          .filter((m) => m.text.trim())
          .map((m) => `${m.speaker === 'me' ? '我' : personName}：${m.text.trim()}`)
          .join('\n');
        if (!lines) return '';
        const header = segments.length > 1 || seg.date.trim() ? `【第${si + 1}段${seg.date.trim() ? ` · ${seg.date.trim()}` : ''}】\n` : '';
        return header + lines;
      })
      .filter(Boolean)
      .join('\n\n');
  const updateMsg = (si: number, mi: number, patch: Partial<Msg>) =>
    setSegments((segs) => segs.map((seg, i) => (i === si ? { ...seg, items: seg.items.map((m, j) => (j === mi ? { ...m, ...patch } : m)) } : seg)));
  const addMsg = (si: number) =>
    setSegments((segs) => segs.map((seg, i) => {
      if (i !== si) return seg;
      const last = seg.items[seg.items.length - 1];
      return { ...seg, items: [...seg.items, { speaker: last?.speaker === 'me' ? 'them' : 'me', text: '' }] };
    }));
  const delMsg = (si: number, mi: number) =>
    setSegments((segs) => segs.map((seg, i) => (i === si ? { ...seg, items: seg.items.filter((_, j) => j !== mi) } : seg)));
  const addSegment = () => setSegments((segs) => [...segs, { date: '', items: [{ speaker: 'them', text: '' }, { speaker: 'me', text: '' }] }]);
  const removeSegment = (si: number) => setSegments((segs) => segs.filter((_, i) => i !== si));

  // 截图识别
  const [picking, setPicking] = useState(false);
  const [shotStep, setShotStep] = useState<null | 'edit'>(null);
  const [shotImage, setShotImage] = useState<string | null>(null);
  const [shotMessages, setShotMessages] = useState<{ speaker: string; text: string }[]>([]);

  const doCopy = async (t: string) => {
    try { await Clipboard.setStringAsync(t); Alert.alert('已复制'); } catch { Alert.alert('复制失败'); }
  };

  const stopPolling = () => { if (pollTimer) { clearInterval(pollTimer); setPollTimer(null); } };

  // 提交分析
  const submit = async (oChat?: string, oThought?: string) => {
    if (loading) return;
    const chat = oChat ?? (inputMode === 'bubble' ? buildMsgText() : chatInput);
    const thought = oThought ?? thoughtInput;
    if (!chat.trim() && !shotMessages.length) { Alert.alert('提示', '请先输入聊天内容（逐句填写或粘贴，也可用截图识别）'); return; }
    setLoading(true); setBtnState('loading'); setResult(null); setModerated(false); setMarks({});
    setStreamText(''); setGhost({ thoughts: [], suggestions: [] });
    const growth = await api.settings().catch(() => ({ growth_mode: 'canned' }));
    const gmode = (growth?.growth_mode === 'hint' || growth?.growth_mode === 'critique' ? growth.growth_mode : 'canned') as 'hint' | 'critique' | 'canned';
    const styleExamples = await gatherStyleExamples();

    // 「自带钥匙」模式：本机已有 DeepSeek Key → 直连 api.deepseek.com（流式逐字返回）
    const dsKey = await getDsKey();
    if (dsKey) {
      const sReq = {
        apiKey: dsKey,
        personName,
        chatRecord: chat,
        myThought: thought,
        myReply: gmode === 'critique' ? thought : undefined,
        growthMode: gmode,
        tone,
        styleExamples,
      };
      let dr = await analyzeDirectStream(sReq, (full) => {
        setStreamText(full);
        setGhost(progressiveExtract(full));
      });
      // 流式失败（非密钥问题）→ 降级为非流式重试
      if (!dr.ok && dr.kind !== 'auth') dr = await analyzeDirect(sReq);
      if (!dr.ok) {
        setBtnState('idle'); setLoading(false);
        if (dr.kind === 'auth') {
          Alert.alert('API Key 无效', '你填写的 DeepSeek API Key 无法使用，请到「设置」页检查/更换。');
        } else {
          Alert.alert('分析失败', dr.message || '请稍后再试');
        }
        return;
      }
      setResult(dr.json);
      setBtnState('success'); setTimeout(() => setBtnState('idle'), 1200);
      // 尽力持久化到时间线/温度（后端可达即保存，不可达则仅本次显示）
      const rid = await saveComputedBestEffort({
        person_id: personId,
        chat_input: chat,
        thought_input: thought,
        result: dr.json,
      });
      setRecordId(rid);
      setLoading(false);
      return;
    }

    try {
      const payload: any = { person_id: personId, chat_input: chat, thought_input: thought, tone };
      if (gmode === 'critique') payload.my_reply = thought;
      if (styleExamples?.length) payload.style_examples = styleExamples;
      const res = await api.analyze(payload);
      if (res.moderated) {
        setModerated(true);
        setResult({ message: res.message });
        setLoading(false);
        return;
      }
      setRecordId(res.record_id);
      // 轮询结果
      const tick = async () => {
        try {
          const rec = await api.analysis(res.record_id);
          if (rec.status === 'done') {
            stopPolling();
            setResult(rec.result || {});
            setMarks((rec.result?.marks) || {});
            setBtnState('success'); setTimeout(() => setBtnState('idle'), 1200);
            setLoading(false);
          } else if (rec.status === 'failed') {
            stopPolling();
            Alert.alert('分析失败', '请稍后再试');
            setBtnState('idle'); setLoading(false);
          }
        } catch { /* 轮询期间出错继续 */ }
      };
      tick();
      const timer = setInterval(tick, 2000);
      setPollTimer(timer);
    } catch (e: any) {
      setBtnState('idle'); setLoading(false);
      const msg = e?.message || '';
      const isNet = /网络|Network|connect|Failed to fetch|fetch/i.test(msg);
      if (isNet) {
        // 后端不可达且未配 Key → 引导去设置填写 DeepSeek Key（App 内直连）
        Alert.alert('需要配置 AI 接入', '当前连不上内置分析服务。请到底部「设置」→「DeepSeek API Key」填写你的密钥，即可在 App 内直接分析（密钥只存本机）。', [
          { text: '知道了' },
        ]);
      } else {
        Alert.alert('分析失败', msg || '请稍后再试');
      }
    }
  };

  const markSuggestion = async (index: number, used: boolean) => {
    if (!recordId) return;
    const next = { ...marks, [String(index)]: used };
    setMarks(next);
    try { await api.markSuggestion(recordId, index, used); } catch { /* 忽略 */ }
  };

  // 选择截图
  const pickImage = async () => {
    try {
      await ImagePicker.requestMediaLibraryPermissionsAsync();
      const result2 = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.9,
        base64: false,
      });
      if (result2.canceled || !result2.assets?.length) return;
      setShotImage(result2.assets[0].uri);
      setShotMessages([]);
      setPicking(true);
      await runRecognize({ uri: result2.assets[0].uri, mime: result2.assets[0].mimeType || 'image/jpeg', name: result2.assets[0].fileName || 'chat.jpg' });
    } catch (e: any) {
      Alert.alert('选择失败', e?.message);
    }
  };

  const runRecognize = async (file: any) => {
    try {
      const fd = new FormData();
      const f = await createFormDataFile(file.uri, file.name, file.mime);
      (fd as any).append('image', f as any);
      (fd as any).append('person_name', personName);
      const data = await api.recognize(fd);
      if (!data.messages || !data.messages.length) throw new Error('未识别出对话');
      setShotMessages(data.messages);
      setShotStep('edit');
    } catch (e: any) {
      Alert.alert('识别失败', `${e?.message ?? '请稍后重试'}。也可以直接粘贴聊天记录，不影响分析。`, [
        { text: '知道了', onPress: () => { setShotImage(null); setPicking(false); setShotStep(null); } },
      ]);
      setPicking(false);
    }
  };

  // AI 分句：把整段粘贴的原始聊天记录拆成逐句+说话人，回填「逐句确认」模式
  const [parsing, setParsing] = useState(false);
  const smartParse = async () => {
    if (!chatInput.trim() || parsing) return;
    setParsing(true);
    try {
      const { messages } = await api.parseChat(chatInput, personName);
      // 转成本地段落结构（单段）
      setSegments([
        {
          date: '',
          items: messages.map((m) => ({
            speaker: (m.speaker === '我' ? 'me' : 'them') as 'me' | 'them',
            text: m.text,
          })),
        },
      ]);
      setInputMode('bubble');
      Alert.alert('AI 分句完成', '已按对话逐句拆开并标好谁说的，快速核对或修改后即可分析。');
    } catch (e: any) {
      Alert.alert('AI 分句失败', `${e?.message ?? '请重试'}。你也可以直接点下方按钮发起分析（AI 会自行理解整段文字）。`);
    } finally {
      setParsing(false);
    }
  };

  const buildShotText = () => shotMessages.map((m) => `${m.speaker === '我' ? '我' : personName}：${m.text}`).join('\n');

  const useShot = () => {
    setChatInput(buildShotText());
    setInputMode('paste');
    setShotStep(null); setShotImage(null); setPicking(false);
  };

  const underlyingGrowthRef = useRef('canned');

  if (!personId) return null;

  return (
    <Screen safeAreaEdges={['top', 'left', 'right', 'bottom']}>
      {/* 私密感：柔和背景层（半透明暖雾） */}
      <View style={StyleSheet.absoluteFill}>
        <View className="absolute -top-24 -right-16 w-64 h-64 rounded-full bg-mist-soft" />
        <View className="absolute top-40 -left-20 w-56 h-56 rounded-full bg-accent-soft" />
        <View className="absolute bottom-0 right-0 w-40 h-40 rounded-full bg-mist-soft" />
      </View>

      <View className="px-4 pt-2 pb-1 flex-row items-center justify-between">
        <TouchableOpacity onPress={() => { stopPolling(); router.back(); }} hitSlop={10} className="w-10 h-10 justify-center">
          <Text className="text-2xl text-foreground">‹</Text>
        </TouchableOpacity>
        <Text className="text-lg font-bold text-foreground">帮我分析 · {personName}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
        {/* 分析入口说明 */}
        <Text className="mt-3 text-[13px] text-muted leading-5">
          推荐直接粘贴聊天记录，AI 自动分清谁说的；也可以逐句确认，或用截图识别。
        </Text>

        {/* 双输入 */}
        <View className="mt-5">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-[15px] font-semibold text-foreground">聊天记录</Text>
            <View className="flex-row items-center">
              <View className="flex-row bg-on-surface rounded-full p-0.5 mr-2">
                <TouchableOpacity
                  onPress={() => setInputMode('bubble')}
                  className={`px-3 h-7 rounded-full items-center justify-center ${inputMode === 'bubble' ? 'bg-white shadow-sm' : ''}`}
                >
                  <Text className={`text-[12px] ${inputMode === 'bubble' ? 'text-foreground font-semibold' : 'text-muted'}`}>逐句确认</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setInputMode('paste')}
                  className={`px-3 h-7 rounded-full items-center justify-center ${inputMode === 'paste' ? 'bg-white shadow-sm' : ''}`}
                >
                  <Text className={`text-[12px] ${inputMode === 'paste' ? 'text-foreground font-semibold' : 'text-muted'}`}>直接粘贴</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={pickImage} className="px-3 h-8 bg-accent-soft rounded-full items-center justify-center">
                {picking ? <ActivityIndicator size="small" color="#E4572E" /> : <Text className="text-[12px] text-accent font-medium">截图识别</Text>}
              </TouchableOpacity>
            </View>
          </View>

          {inputMode === 'paste' ? (
            <View>
              <TextInput
                value={chatInput}
                onChangeText={setChatInput}
                placeholder={`直接粘贴和 ${personName} 的聊天记录即可，不用标注谁说的。\n例：\n昨天加班到很晚，累死了\n那你早点休息吧`}
                placeholderTextColor="#C9C9C9"
                multiline
                textAlignVertical="top"
                className="bg-surface rounded-2xl border border-border px-4 py-3 text-[15px] text-foreground min-h-[150px]"
              />
              {/* AI 一键分句：粘贴完先分句核对，再分析更准 */}
              <TouchableOpacity
                onPress={smartParse}
                disabled={parsing || !chatInput.trim()}
                className="mt-2 h-9 rounded-full bg-accent-soft items-center justify-center flex-row self-start px-4"
              >
                {parsing ? (
                  <ActivityIndicator size="small" color="#E4572E" />
                ) : (
                  <Text className="text-[12px] text-accent font-medium">✨ AI 分句 · 逐句核对（可选）</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              {segments.map((seg, si) => (
                <View key={si}>
                  {(segments.length > 1 || seg.date.trim()) && (
                    <View className="flex-row items-center justify-between mb-2 mt-1">
                      <TextInput
                        value={seg.date}
                        onChangeText={(t) => setSegments((segs) => segs.map((x, i) => (i === si ? { ...x, date: t } : x)))}
                        placeholder={`第 ${si + 1} 段日期，如：10月15日（选填）`}
                        placeholderTextColor="#9C9CA3"
                        className="flex-1 bg-on-surface rounded-full px-3.5 h-8 text-[12px] text-foreground border border-border"
                      />
                      {segments.length > 1 && (
                        <TouchableOpacity onPress={() => removeSegment(si)} hitSlop={6} className="ml-2">
                          <Text className="text-muted text-[12px]">✕ 删段</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  {seg.items.map((m, mi) => {
                    const mine = m.speaker === 'me';
                    return (
                      <View key={mi} className={`flex-row items-start mb-3 ${mine ? 'justify-end' : ''}`}>
                        {/* 头像：对方靠左，我靠右（微信式） */}
                        {!mine && <ChatAvatar label={personName.charAt(0) || 'TA'} color="#7A9BCE" />}
                        <View style={{ maxWidth: '68%', paddingHorizontal: 6 }}>
                          <TextInput
                            value={m.text}
                            onChangeText={(t) => updateMsg(si, mi, { text: t })}
                            placeholder={mine ? '我说的…' : `${personName}说的…`}
                            placeholderTextColor="#9CA3AF"
                            multiline
                            textAlignVertical="center"
                            style={{
                              backgroundColor: mine ? '#95EC69' : '#FFFFFF',
                              borderColor: mine ? '#86DB5B' : '#E6E6E6',
                              borderWidth: 1,
                              borderRadius: 8,
                              paddingHorizontal: 12,
                              paddingVertical: 9,
                              fontSize: 15,
                              color: '#111111',
                            }}
                          />
                        </View>
                        {mine && <MeAvatar />}
                        {/* 切换说话人（点头像）+ 删除 */}
                        <TouchableOpacity onPress={() => updateMsg(si, mi, { speaker: mine ? 'them' : 'me' })} hitSlop={6} className="ml-1 mt-2">
                          <Text className="text-[12px] text-muted px-1 py-1">换</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => delMsg(si, mi)} hitSlop={6} className="ml-1 mt-2">
                          <Text className="text-muted text-[14px] px-1 py-1">✕</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    onPress={() => addMsg(si)}
                    className="mt-1 mb-2 self-start px-4 h-9 rounded-full bg-accent-soft items-center justify-center"
                  >
                    <Text className="text-[12.5px] text-accent font-medium">＋ 本段加一句</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <View className="flex-row items-center justify-between mt-1 flex-wrap gap-2">
                <TouchableOpacity
                  onPress={addSegment}
                  className="self-start px-4 h-9 rounded-full bg-accent-soft items-center justify-center"
                >
                  <Text className="text-[13px] text-accent font-medium">＋ 添加段落（不同时间的聊天）</Text>
                </TouchableOpacity>
              </View>
              <Text className="mt-2 text-[10px] text-muted/70">
                点「换」切换说话人；多天的聊天建议分不同段落，AI 会按时间线综合分析
              </Text>
            </View>
          )}
        </View>

        <View className="mt-5">
          <View className="flex-row items-center mb-2">
            <Text className="text-[15px] font-semibold text-foreground">我的想法</Text>
            <Text className="ml-1.5 text-[12px] text-muted">选填</Text>
          </View>
          <TextInput
            value={thoughtInput}
            onChangeText={setThoughtInput}
            placeholder="此刻你想说什么 / 担心什么？例：我怕说错话让她更烦"
            placeholderTextColor="#C9C9C9"
            multiline
            textAlignVertical="top"
            className="bg-surface rounded-2xl border border-border px-4 py-3 text-[15px] text-foreground min-h-[90px]"
          />
          <Text className="mt-1.5 text-[11px] text-muted">不填也完全可以分析；写了的话，AI 会结合你的顾虑给出更贴合的建议。</Text>
        </View>

        {/* 语气选择 */}
        <View className="mt-5">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-[15px] font-semibold text-foreground">建议的语气</Text>
            <Text className="text-[13px] font-semibold text-accent">{tone}</Text>
          </View>
          <View className="flex-row bg-on-surface rounded-2xl p-1">
            {tones.map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setTone(t)}
                className={`flex-1 h-11 rounded-xl items-center justify-center ${tone === t ? 'bg-surface shadow-sm' : ''}`}
              >
                <Text className={`text-[14px] font-semibold ${tone === t ? 'text-accent' : 'text-foreground/55'}`}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <AnimatedButton state={btnState} onPress={() => submit()} label="帮我分析" />

        {/* 分析进度：阶段清单 + 流式实时预览 */}
        {loading && (
          <View className="mt-4 rounded-2xl border border-border bg-white px-4 py-3">
            {ANALYZE_STAGES.map((s, i) => (
              <View key={i} className="flex-row items-center mb-1">
                <Text className={`text-[12px] ${i < stageIdx ? 'text-muted' : i === stageIdx ? 'text-accent font-semibold' : 'text-muted/45'}`}>
                  {i < stageIdx ? '✓ ' : i === stageIdx ? '◐ ' : '○ '}{s}
                </Text>
              </View>
            ))}
            {!!streamText && (
              <View className="mt-2 rounded-xl bg-on-surface px-3 py-2">
                <Text className="text-[11px] font-semibold text-foreground/60 mb-1">实时预览</Text>
                <ScrollView style={{ maxHeight: 130 }}>
                  {ghost.thoughts.map((t, i) => (
                    <Text key={`t${i}`} className="text-[12px] text-foreground/80 leading-4 mb-1">💡 {t}</Text>
                  ))}
                  {ghost.suggestions.map((s, i) => (
                    <Text key={`s${i}`} className="text-[12px] leading-4 mb-1" style={{ color: '#3E8E41' }}>→ {s}</Text>
                  ))}
                </ScrollView>
                <Text className="text-[10px] text-muted/60 mt-1">已生成 {streamText.length} 字…</Text>
              </View>
            )}
          </View>
        )}

        {/* 冷静一下（节制提示） */}
        <TouchableOpacity
          onPress={() => { if (!moderated) { Alert.alert('冷静一下', '先去做别的事吧。如果真的很纠结，等 24 小时后再回来。'); } }}
          className="mt-3 py-1 self-center"
        >
          <Text className="text-[13px] text-muted">冷静一下</Text>
        </TouchableOpacity>

        {/* 结果区 */}
        {moderated && result?.message && (
          <View className="mt-6 rounded-2xl border border-border px-5 py-6 items-center" style={{ backgroundColor: 'rgba(255,253,251,0.92)' }}>
            <Text className="text-[15px] text-muted text-center leading-6">{result.message}</Text>
            <View className="mt-4 flex-row space-x-3">
              <TouchableOpacity onPress={() => router.back()} className="px-5 h-10 bg-accent-soft rounded-full items-center justify-center">
                <Text className="text-accent text-[14px] font-medium">去做点什么</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setModerated(false)} className="px-5 h-10 bg-accent rounded-full items-center justify-center">
                <Text className="text-white text-[14px] font-medium">冷静一下返回</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!moderated && result && result.thoughts && <ResultView result={result} marks={marks} onCopy={doCopy} onMark={markSuggestion} />}
      </ScrollView>

      {/* 截图核对 Modal */}
      <Modal visible={shotStep === 'edit'} transparent animationType="slide" onRequestClose={() => setShotStep(null)}>
        <View className="flex-1 bg-black/30 justify-end">
          <View className="bg-surface rounded-t-3xl p-6 pb-8">
            <Text className="text-xl font-bold text-foreground mb-1">核对识别结果</Text>
            <Text className="text-[13px] text-muted mb-4">请确认说话人和内容，识别可能不准确，可直接修改。</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {shotMessages.map((m, i) => (
                <View key={i} className="flex-row items-center mb-2 space-x-2">
                  <TouchableOpacity
                    onPress={() => setShotMessages((ms) => ms.map((x, idx) => idx === i ? { ...x, speaker: x.speaker === '我' ? '对方' : '我' } : x ))}
                    className="px-3 h-10 bg-accent-soft rounded-xl items-center justify-center"
                  >
                    <Text className="text-[13px] text-accent font-medium">{m.speaker === '我' ? '我' : personName}</Text>
                  </TouchableOpacity>
                  <TextInput
                    value={m.text}
                    onChangeText={(t) => setShotMessages((ms) => ms.map((x, idx) => idx === i ? { ...x, text: t } : x))}
                    className="flex-1 bg-on-surface rounded-xl px-3 py-2 text-[15px] text-foreground"
                    multiline
                  />
                </View>
              ))}
            </ScrollView>
            <View className="flex-row space-x-3 mt-4">
              <TouchableOpacity onPress={() => setShotStep(null)} className="flex-1 h-12 rounded-xl bg-accent-soft items-center justify-center">
                <Text className="text-accent font-medium">取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={useShot} className="flex-1 h-12 rounded-xl bg-accent items-center justify-center">
                <Text className="text-white font-medium">使用并填入</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

/** 三态分析按钮：点击收缩成圆形出加载圈，完成变绿出对勾 */
function AnimatedButton({ state, onPress, label }: { state: 'idle' | 'loading' | 'success'; onPress: () => void; label: string }) {
  const w = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: state === 'loading' ? 0 : 1, duration: 240, useNativeDriver: false }).start();
  }, [state]);
  const width = w.interpolate({ inputRange: [0, 1], outputRange: [58, 340] });
  const bg = state === 'success' ? '#34C759' : '#E4572E';
  return (
    <Animated.View
      style={{
        height: 56, width, backgroundColor: bg, borderRadius: 18,
        marginTop: 24, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}
    >
      <TouchableOpacity onPress={onPress} disabled={state !== 'idle'} style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
        {state === 'loading' ? (
          <ActivityIndicator color="#fff" />
        ) : state === 'success' ? (
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800' }}>✓</Text>
        ) : (
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>{label}</Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

/** 微信式圆形头像 */
function ChatAvatar({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ width: 38, height: 38, borderRadius: 6, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text className="text-white font-semibold text-[15px]">{label}</Text>
    </View>
  );
}

/** 三段结果渲染 */
function ResultView({ result, marks, onCopy, onMark }: any) {
  const [copiedNote, setCopiedNote] = useState<string | null>(null);
  const [openTheory, setOpenTheory] = useState<string | null>(null);
  const temp = result.temperature || {};
  const handleCopy = (t: string, key: string) => { onCopy(t); setCopiedNote(key); setTimeout(() => setCopiedNote(null), 1500); };

  return (
    <View className="mt-8 rounded-3xl border border-border overflow-hidden" style={{ backgroundColor: '#ECECEC' }}>
      {/* 微信式：顶部居中「时间戳」位放场景与温度 */}
      <View className="items-center pt-4 pb-1">
        {!!result.scene && (
          <View className="px-3 py-1 rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}>
            <Text className="text-[11px] text-[#7C7C7C]">场景 · {result.scene}</Text>
          </View>
        )}
        <View className="mt-1.5 px-3 py-1 rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.05)' }}>
          <Text className="text-[11px] text-[#7C7C7C]">
            关系温度 · <Text className="font-semibold" style={{ color: TEMP_COLOR[temp.label] || '#666' }}>{temp.label}</Text>
            {!!temp.reason ? `（${temp.reason}）` : ''}
          </Text>
        </View>
      </View>

      <View className="px-3.5 pt-2 pb-5">
        {/* 分享卡（Web 端下载 PNG） */}
        <ShareCard result={result} />

        {/* 对面在想什么 → 对方气泡（左侧，带头像） */}
        <View className="items-center pb-2">
          <Text className="text-[11px] text-[#9C9C9C]">以下是他心里的想法</Text>
        </View>
        {(result.thoughts || []).map((t: any, i: number) => (
          <View key={i} className="flex-row items-start mb-2.5">
            <ChatAvatar label="TA" color="#AAB4C4" />
            <View style={{ maxWidth: '78%', marginLeft: 8 }}>
              <View style={{ backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, alignSelf: 'flex-start' }}>
                <Text className="text-[14px] leading-5" style={{ color: '#111111' }}>{t.point}</Text>
                {!!t.evidence && <Text className="text-[11px] leading-4 mt-1" style={{ color: '#8A8A8A' }}>{t.evidence}</Text>}
              </View>
            </View>
          </View>
        ))}

        {/* 建议回复 → 我的绿色气泡（右侧，带头像） */}
        {!!(result.suggestions || []).length && (
          <View className="items-center pt-3 pb-2">
            <Text className="text-[11px] text-[#9C9C9C]">你可以这样回（点文字复制）</Text>
          </View>
        )}
        {(result.suggestions || []).map((s: any, i: number) => {
          const used = marks[String(i)];
          return (
            <View key={i} className="mb-3">
              <View className="flex-row justify-end items-start">
                <View style={{ maxWidth: '80%' }}>
                  <View className="flex-row items-center justify-end mb-1">
                    <Text className="text-[11px] text-muted mr-2">〔{s.style}〕</Text>
                    <TouchableOpacity onPress={() => onMark(i, !used)} className="px-1.5">
                      <Text className="text-[12px] text-muted px-1">{used === undefined ? '标记' : used ? '✓ 用了' : '没用上'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleCopy(s.text, `s${i}`)} hitSlop={8} className="px-1.5">
                      <Text className="text-[12px] text-accent px-1">{copiedNote === `s${i}` ? '已复制' : '复制'}</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => handleCopy(s.text, `s${i}`)}>
                    <View style={{ backgroundColor: '#95EC69', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, alignSelf: 'flex-end' }}>
                      <Text className="text-[15px] leading-6" style={{ color: '#111111' }}>{s.text}</Text>
                    </View>
                  </TouchableOpacity>
                  {!!s.reason && <Text className="text-[11px] text-muted mt-1 text-right">理由：{s.reason}</Text>}
                  {!!s.theory_tag && (
                    <View className="mt-1.5 items-end">
                      <TouchableOpacity
                        onPress={() => setOpenTheory(openTheory === `s${i}` ? null : `s${i}`)}
                        className="flex-row items-center rounded-full bg-surface/900 px-3 py-1 border border-border"
                        hitSlop={6}
                      >
                        <Text className="text-[11px] font-medium text-accent">依据：{s.theory_tag}</Text>
                        <Text className="ml-1 text-[9px] text-accent/70">{openTheory === `s${i}` ? '▲' : '▼'}</Text>
                      </TouchableOpacity>
                      {openTheory === `s${i}` && (() => {
                        const card = findMethodByTitle(s.theory_tag);
                        if (!card) return null;
                        return (
                          <View className="mt-2 rounded-xl border border-border bg-white px-3.5 py-3">
                            <Text className="text-[12px] font-semibold text-foreground">《{card.title}》 · {card.source}</Text>
                            <Text className="mt-1 text-[12px] leading-5 text-foreground/75">{card.summary}</Text>
                            {card.core[0] && <Text className="mt-1 text-[12px] leading-5 text-foreground/70">· {card.core[0]}</Text>}
                            {card.usage && <Text className="mt-1 text-[12px] leading-5 text-muted">使用要点：{card.usage}</Text>}
                            {card.forbid && <Text className="mt-1 text-[12px] leading-5 text-muted">禁用提醒：{card.forbid}</Text>}
                          </View>
                        );
                      })()}
                    </View>
                  )}
                </View>
                <View className="ml-2">
                  <MeAvatar />
                </View>
              </View>
            </View>
          );
        })}

        {/* 注意事项 → 微信系统提示样式（居中灰字） */}
        {(result.notes || []).length > 0 && (
          <View className="items-center pt-2">
            {(result.notes || []).map((nt: string, i: number) => (
              <Text key={i} className="text-[11px] text-[#9C9C9C] text-center leading-4 px-6 mb-1">{nt}</Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function Section({ title, hint, children }: any) {
  return (
    <View className="mt-6">
      <Text className="text-[15px] font-semibold text-foreground mb-2">{title}</Text>
      {!!hint && <Text className="text-[11px] text-muted mb-2">{hint}</Text>}
      {children}
    </View>
  );
}

/** 分析结果分享卡：Web 端通过 html-to-image（CDN）导出 PNG；脱敏——不含聊天原文 */
function ShareCard({ result }: { result: any }) {
  const ref = React.useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const exportPng = async () => {
    if (Platform.OS !== 'web' || !ref.current) {
      Alert.alert('提示', '请在网页版使用图片导出；App 内可截图分享');
      return;
    }
    setBusy(true);
    try {
      const w = window as any;
      if (!w.htmlToImage) {
        await new Promise<void>((res, rej) => {
          const sc = document.createElement('script');
          sc.src = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js';
          sc.onload = () => res();
          sc.onerror = () => rej(new Error('组件加载失败'));
          document.head.appendChild(sc);
        });
      }
      const dataUrl = await w.htmlToImage.toPng(ref.current, { pixelRatio: 2, backgroundColor: '#0b1128' });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `echo-mentor-分享卡-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch (e: any) {
      Alert.alert('导出失败', e?.message || '请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  const first = result?.suggestions?.[0];
  const date = new Date().toISOString().slice(0, 10);

  return (
    <View>
      <TouchableOpacity onPress={exportPng} disabled={busy} className="self-end px-3 h-7 rounded-full bg-accent-soft items-center justify-center mb-2">
        {busy ? <ActivityIndicator size="small" color="#E4572E" /> : <Text className="text-[11px] text-accent font-medium">{done ? '已保存 ✓' : '🖼 生成分享图'}</Text>}
      </TouchableOpacity>
      {/* 仅 Web 渲染离屏卡片；App 端提示截图 */}
      {Platform.OS === 'web' && (
        <View ref={ref} collapsable={false} style={{ position: 'absolute', left: -9999, top: 0, width: 360, backgroundColor: '#0b1128', borderRadius: 16, padding: 20 }}>
          <Text style={{ color: '#5BC0DE', fontSize: 12, letterSpacing: 2 }}>ECHO MENTOR · 需求拆解师</Text>
          <Text style={{ color: '#FFFFFF', fontSize: 18, fontWeight: '700', marginTop: 8 }}>{result?.scene || '沟通分析'} · 关系温度 {result?.temperature?.label || '—'}</Text>
          {!!result?.thoughts?.[0]?.point && (
            <Text style={{ color: '#C9D6F0', fontSize: 12, marginTop: 10, lineHeight: 18 }}>洞察：{result.thoughts[0].point}</Text>
          )}
          {!!first?.text && (
            <View style={{ backgroundColor: '#95EC69', borderRadius: 8, padding: 10, marginTop: 12 }}>
              <Text style={{ color: '#111111', fontSize: 12, lineHeight: 17 }}>{first.text}</Text>
            </View>
          )}
          <Text style={{ color: '#6b7c96', fontSize: 10, marginTop: 14 }}>我清楚地表达了自己的想法 —— Echo Mentor 帮我做到的</Text>
          <Text style={{ color: '#4a5a75', fontSize: 10, marginTop: 4 }}>{date}</Text>
        </View>
      )}
    </View>
  );
}
