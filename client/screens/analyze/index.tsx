import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView, Alert, ActivityIndicator, Platform, Modal, StyleSheet,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
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
  const [tone, setTone] = useState<'正式' | '日常' | '熟昵'>('日常');
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
      return out.length ? out.slice(0, 8) : undefined;
    } catch { return undefined; }
  };

  // 对话输入模式：bubble=逐句标说话人 / paste=整段粘贴
  const [inputMode, setInputMode] = useState<'bubble' | 'paste'>('bubble');
  const [msgs, setMsgs] = useState<{ speaker: 'me' | 'them'; text: string }[]>([
    { speaker: 'them', text: '' },
    { speaker: 'me', text: '' },
  ]);
  const buildMsgText = () =>
    msgs
      .filter((m) => m.text.trim())
      .map((m) => `${m.speaker === 'me' ? '我' : personName}：${m.text.trim()}`)
      .join('\n');
  const updateMsg = (i: number, patch: Partial<{ speaker: 'me' | 'them'; text: string }>) =>
    setMsgs((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

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
    setLoading(true); setResult(null); setModerated(false); setMarks({});
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
        setLoading(false);
        if (dr.kind === 'auth') {
          Alert.alert('API Key 无效', '你填写的 DeepSeek API Key 无法使用，请到「设置」页检查/更换。');
        } else {
          Alert.alert('分析失败', dr.message || '请稍后再试');
        }
        return;
      }
      setResult(dr.json);
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
            setLoading(false);
          } else if (rec.status === 'failed') {
            stopPolling();
            Alert.alert('分析失败', '请稍后再试');
            setLoading(false);
          }
        } catch { /* 轮询期间出错继续 */ }
      };
      tick();
      const timer = setInterval(tick, 2000);
      setPollTimer(timer);
    } catch (e: any) {
      setLoading(false);
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
      Alert.alert('识别失败', '已为你降级为手动粘贴，请自行输入聊天记录', [
        { text: '知道了', onPress: () => { setShotImage(null); setPicking(false); setShotStep(null); } },
      ]);
      setPicking(false);
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
          一句一句填对话，每句标上是谁说的，AI 就能分清「我说的」和「{personName}说的」；也可以直接粘贴或用截图识别。
        </Text>

        {/* 双输入 */}
        <View className="mt-5">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-[15px] font-semibold text-foreground">聊天记录</Text>
            <View className="flex-row items-center">
              <View className="flex-row bg-[#F1F1F1] rounded-full p-0.5 mr-2">
                <TouchableOpacity
                  onPress={() => setInputMode('bubble')}
                  className={`px-3 h-7 rounded-full items-center justify-center ${inputMode === 'bubble' ? 'bg-white shadow-sm' : ''}`}
                >
                  <Text className={`text-[12px] ${inputMode === 'bubble' ? 'text-foreground font-semibold' : 'text-muted'}`}>逐句输入</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setInputMode('paste')}
                  className={`px-3 h-7 rounded-full items-center justify-center ${inputMode === 'paste' ? 'bg-white shadow-sm' : ''}`}
                >
                  <Text className={`text-[12px] ${inputMode === 'paste' ? 'text-foreground font-semibold' : 'text-muted'}`}>整段粘贴</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={pickImage} className="px-3 h-8 bg-accent-soft rounded-full items-center justify-center">
                {picking ? <ActivityIndicator size="small" color="#E4572E" /> : <Text className="text-[12px] text-accent font-medium">截图识别</Text>}
              </TouchableOpacity>
            </View>
          </View>

          {inputMode === 'paste' ? (
            <TextInput
              value={chatInput}
              onChangeText={setChatInput}
              placeholder={`例：\n${personName}：昨天加班到很晚，累死了\n我：那你早点休息吧`}
              placeholderTextColor="#C9C9C9"
              multiline
              textAlignVertical="top"
              className="bg-surface rounded-2xl border border-border px-4 py-3 text-[15px] text-foreground min-h-[150px]"
            />
          ) : (
            <View>
              {msgs.map((m, i) => {
                const mine = m.speaker === 'me';
                return (
                  <View key={i} className={`flex-row items-start mb-3 ${mine ? 'justify-end' : ''}`}>
                    {/* 头像：对方靠左，我靠右（微信式） */}
                    {!mine && <ChatAvatar label={personName.charAt(0) || 'TA'} color="#7A9BCE" />}
                    <View style={{ maxWidth: '68%', paddingHorizontal: 6 }}>
                      <TextInput
                        value={m.text}
                        onChangeText={(t) => updateMsg(i, { text: t })}
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
                    {mine && <ChatAvatar label="我" color="#FF7A5C" />}
                    {/* 切换说话人（点头像）+ 删除 */}
                    <TouchableOpacity onPress={() => updateMsg(i, { speaker: mine ? 'them' : 'me' })} hitSlop={6} className="ml-1 mt-2">
                      <Text className="text-[10px] text-muted">换</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setMsgs((ms) => ms.filter((_, idx) => idx !== i))} hitSlop={6} className="ml-1 mt-2">
                      <Text className="text-muted text-[12px]">✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
              <View className="flex-row items-center justify-between mt-1">
                <TouchableOpacity
                  onPress={() => setMsgs((ms) => [...ms, { speaker: ms[ms.length - 1]?.speaker === 'me' ? 'them' : 'me', text: '' }])}
                  className="self-start px-3 h-8 rounded-full bg-accent-soft items-center justify-center"
                >
                  <Text className="text-[12px] text-accent font-medium">＋ 添加一句</Text>
                </TouchableOpacity>
                <Text className="text-[10px] text-muted/70">点头像旁边的「换」可切换谁说的</Text>
              </View>
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
          <View className="flex-row items-center mb-2">
            <Text className="text-[15px] font-semibold text-foreground">建议的语气</Text>
            <Text className="ml-1.5 text-[11px] text-muted">AI 会按这个感觉生成建议</Text>
          </View>
          <View className="flex-row bg-[#EFEFEF] rounded-full p-0.5">
            {(['正式', '日常', '熟昵'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setTone(t)}
                className={`flex-1 h-9 rounded-full items-center justify-center ${tone === t ? 'bg-white shadow-sm' : ''}`}
              >
                <Text className={`text-[13px] ${tone === t ? 'text-foreground font-semibold' : 'text-foreground/55'}`}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          onPress={() => submit()}
          disabled={loading}
          className="mt-6 bg-accent rounded-2xl py-4 items-center justify-center shadow-accent"
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold text-base">帮我分析</Text>}
        </TouchableOpacity>

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
              <View className="mt-2 rounded-xl bg-[#F6F6F8] px-3 py-2">
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
                      <Text className="text-[11px] text-muted">{used === undefined ? '标记' : used ? '✓ 用了' : '没用上'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleCopy(s.text, `s${i}`)} hitSlop={8} className="px-1.5">
                      <Text className="text-[11px] text-accent">{copiedNote === `s${i}` ? '已复制' : '复制'}</Text>
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
                        className="flex-row items-center rounded-full bg-white/80 px-3 py-1 border border-border"
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
                  <ChatAvatar label="我" color="#FF7A5C" />
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