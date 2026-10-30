import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, TextInput, Alert, ActivityIndicator, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { api, downloadDocx } from '@/utils/api';
import { getDsKey, chatDirect } from '@/utils/deepseek';
import dayjs from 'dayjs';
import Svg, { Path, Defs, LinearGradient as SvgLinearGradient, Stop, Circle, Line, G, Text as SvgText } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/contexts/ThemeContext';
import SwipeRow from '@/components/SwipeRow';

const AVATAR_COLORS = ['#FF7A5C', '#7A9BCE', '#C9A227', '#6FB98F', '#C084FC', '#E4572E', '#5AA9E6'];

interface PersonDetailProps {
  id: string;
}

const TEMP_COLOR: Record<string, string> = {
  热: '#E4572E',
  温: '#C9A227',
  冷: '#7A9BCE',
};

const TEMP_POS: Record<string, number> = { 热: 0, 温: 0.5, 冷: 1 };

// 从档案存储的颜色值（可为空 / 旧数据无颜色）解析头图圆点色
function avatarColor(color?: string): string {
  if (color && (AVATAR_COLORS as string[]).includes(color)) return color;
  // 按称呼哈希稳定取色
  return AVATAR_COLORS[0];
}

/**
 * 人物详情页：档案 + 温度趋势图 + 重要日期 + 时间线
 * 时间线即每次分析历史（记录 + 想法 + 结果 + 温度标签）
 */
export default function PersonDetailScreen() {
  const params = useSafeSearchParams<PersonDetailProps>();
  const router = useSafeRouter();
  const id = params.id;
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';

  const [person, setPerson] = useState<any>(null);
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [temps, setTemps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editModal, setEditModal] = useState(false);
  const [notes, setNotes] = useState<{ text: string; at: number }[]>([]);
  const [noteModal, setNoteModal] = useState(false);
  const [noteInput, setNoteInput] = useState('');
  const [portrait, setPortrait] = useState<any>(null);
  const [loadingPortrait, setLoadingPortrait] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<any>(null);
  const [outcomeInput, setOutcomeInput] = useState('');
  const [savingOutcome, setSavingOutcome] = useState(false);

  const saveOutcome = async () => {
    const t = outcomeInput.trim();
    if (!t || !outcomeFor) return;
    setSavingOutcome(true);
    try {
      await api.analysisOutcome(outcomeFor.id, t);
      setOutcomeFor(null);
      setOutcomeInput('');
      load();
      Alert.alert('已记录', 'AI 评估完成，可在时间线里查看效果与改进建议');
    } catch (e: any) {
      Alert.alert('评估失败', e?.message);
    } finally {
      setSavingOutcome(false);
    }
  };

  const notesKey = `echo_notes_${id}`;
  const loadNotes = async () => {
    try { setNotes(JSON.parse((await AsyncStorage.getItem(notesKey)) || '[]')); } catch { setNotes([]); }
  };
  const saveNote = async () => {
    const t = noteInput.trim();
    if (!t) return;
    const next = [{ text: t, at: Date.now() }, ...notes].slice(0, 50);
    setNotes(next);
    setNoteInput('');
    setNoteModal(false);
    try { await AsyncStorage.setItem(notesKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const deleteNote = async (at: number) => {
    const next = notes.filter((n) => n.at !== at);
    setNotes(next);
    try { await AsyncStorage.setItem(notesKey, JSON.stringify(next)); } catch { /* ignore */ }
  };

  // 关系画像：优先服务端生成，失败且本机有 Key 时直连
  const generatePortrait = async () => {
    if (loadingPortrait) return;
    setLoadingPortrait(true);
    setPortrait(null);
    try {
      const p = await api.portrait(id);
      setPortrait(p);
    } catch {
      try {
        const dsKey = await getDsKey();
        if (!dsKey) throw new Error('需要 AI 接入：请在设置里填写 DeepSeek API Key');
        const digest = (analyses || [])
          .filter((a) => a.status === 'done')
          .slice(0, 10)
          .map((a, i: number) => {
            const pts = (a.result?.thoughts ?? []).slice(0, 2).map((t: any) => t.point).join('；');
            return `${i + 1}) [${a.temp_label}] ${pts || '（无要点）'}`;
          })
          .join('\n');
        const system = `你是关系洞察分析师。基于某位用户与「${person?.name || '对方'}」的历次沟通分析记录，输出一张「关系画像」。严格输出 JSON：
{"style":"TA 的沟通风格（40字内）","landmines":["TA 的雷区/忌讳，1-3条"],"likes":["TA 吃哪套/在意什么，1-3条"],"pattern":"你们关系的整体模式（60字内）","advice":["给用户的具体建议，1-3条"]}
要求：全部基于给定记录提炼，不编造；说人话，每条 ≤ 40 字。`;
        const user = `【人物档案】\n关系：${person?.relationship || '未知'}；背景：${person?.background || '（无）'}\n\n【最近分析记录（新→旧）】\n${digest || '（暂无记录）'}`;
        const raw = await chatDirect(dsKey, system, [{ role: 'user', content: user }], 0.5);
        const s = raw.indexOf('{');
        const e = raw.lastIndexOf('}');
        const parsed = s >= 0 && e > s ? JSON.parse(raw.slice(s, e + 1)) : null;
        if (!parsed) throw new Error('生成失败，请稍后再试');
        setPortrait(parsed);
      } catch (e2: any) {
        Alert.alert('生成失败', e2?.message);
      }
    } finally {
      setLoadingPortrait(false);
    }
  };

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, a, t] = await Promise.all([
        api.person(id),
        api.personAnalyses(id),
        api.personTemperatures(id),
      ]);
      setPerson(p);
      setAnalyses(a || []);
      setTemps(t || []);
    } catch (e: any) {
      Alert.alert('加载失败', e?.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadNotes(); }, [notesKey]);

  if (!id) return null;

  const latestTemp = temps.length ? temps[temps.length - 1].label : '';
  const latestTempColor = TEMP_COLOR[latestTemp] || '#C9A227';

  // 关系体检统计（纯前端计算）
  const stats = React.useMemo(() => {
    let total = 0, mine = 0;
    for (const a of analyses) {
      const lines = (a.chat_input || '').split('\n').filter((l: string) => l.trim());
      total += lines.length;
      mine += lines.filter((l: string) => /^\s*我[:：]/.test(l)).length;
    }
    const weekCount = analyses.filter((a) => dayjs(a.created_at).isAfter(dayjs().subtract(7, 'day'))).length;
    const tempChange = temps.length >= 2 ? `${temps[0].label}→${temps[temps.length - 1].label}` : temps.length ? temps[0].label : '–';
    return { myRatio: total ? Math.round((mine / total) * 100) : null, total: analyses.length, weekCount, tempChange };
  }, [analyses, temps]);

  // 时机提醒：取最近一条带 timing 的分析
  const timing = React.useMemo(() => {
    for (let i = analyses.length - 1; i >= 0; i--) {
      const t = analyses[i]?.result?.timing;
      if (t?.opportunities?.length) return { ...t, from: analyses[i] };
    }
    return null;
  }, [analyses]);

  return (
    <Screen safeAreaEdges={['top', 'left', 'right', 'bottom']}>
      <View className="px-4 pt-2 pb-1">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="w-10 h-10 justify-center">
          <Text className="text-2xl text-foreground">‹</Text>
        </TouchableOpacity>
      </View>

      {loading && !person ? (
        <View className="flex-1 items-center pt-20"><ActivityIndicator color="#666" /></View>
      ) : person ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}>
          {/* 档案头部：渐变卡片 + 称呼大字 + 关系标签 + 温度环 */}
          <LinearGradient
            colors={dark ? ['#221E28', '#241F22', '#1B2029'] : ['#FFF1EC', '#FDE8E4', '#ECEEF8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="rounded-[26px] p-5"
            style={{ shadowColor: '#E4572E', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 3 }}
          >
            <View className="flex-row items-center">
              {/* 自定义彩色圆点头像 */}
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: avatarColor(person.avatar_color), alignItems: 'center', justifyContent: 'center' }}>
                <Text className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>{person.name?.charAt(0)}</Text>
              </View>

              <View className="flex-1 ml-4">
                <Text className="text-[26px] font-bold text-foreground tracking-tight">{person.name}</Text>
                <View className="mt-1.5 flex-row items-center gap-2">
                  <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.72)' }}>
                    <Text className="text-[12px] font-medium text-foreground">{person.relationship || '关系未定义'}</Text>
                  </View>
                  {!!person.growth && (
                    <Text className="text-[11px] text-muted">{person.growth}</Text>
                  )}
                </View>
              </View>

              {/* 温度圆环 */}
              {temps.length > 0 && (
                <View className="items-center">
                  <Svg width={64} height={64} viewBox="0 0 64 64">
                    <Circle cx={32} cy={32} r={26} stroke="#EDE7DF" strokeWidth={6} fill="none" />
                    <Circle
                      cx={32} cy={32} r={26}
                      stroke={latestTempColor} strokeWidth={6} fill="none"
                      strokeDasharray={`${Math.max(2, (TEMP_POS[latestTemp] ?? 0.5) * 163)} 999`}
                      strokeLinecap="round"
                      transform="rotate(-90 32 32)"
                    />
                  </Svg>
                  <View className="absolute items-center">
                    <Text className="text-[22px] font-bold" style={{ color: latestTempColor }}>{latestTemp || '–'}</Text>
                    <Text className="text-[9px] text-muted">当前温度</Text>
                  </View>
                </View>
              )}
            </View>

            {!!person.background && (
              <Text className="mt-4 text-[13px] text-muted leading-5">{person.background}</Text>
            )}

            <TouchableOpacity onPress={() => setEditModal(true)} className="mt-4 self-start px-3.5 h-8 rounded-full items-center justify-center flex-row gap-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.66)' }}>
              <Text className="text-[12px] text-foreground">编辑档案</Text>
              <Text className="text-[12px] text-accent">›</Text>
            </TouchableOpacity>
          </LinearGradient>

          {/* 分析入口 */}
          <TouchableOpacity
            onPress={() => router.push('/analyze', { person_id: id, person_name: person.name })}
            className="mt-5 bg-accent rounded-2xl px-5 py-4 flex-row items-center justify-between"
            style={{ shadowColor: '#E4572E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 }}
          >
            <Text className="text-white font-semibold text-base">💬 开始分析</Text>
            <Text className="text-white/80 text-[13px]">粘贴聊天 → 分析 {'›'}</Text>
          </TouchableOpacity>

          {/* 演练 + 快记 */}
          <View className="mt-3 flex-row gap-3">
            <TouchableOpacity
              onPress={() => router.push('/rehearse', { person_id: id, person_name: person.name })}
              className="flex-1 bg-surface border border-border rounded-2xl px-4 py-3.5 flex-row items-center justify-center"
            >
              <Text className="text-[14px] font-medium text-foreground">🎭 模拟演练</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setNoteModal(true)}
              className="flex-1 bg-surface border border-border rounded-2xl px-4 py-3.5 flex-row items-center justify-center"
            >
              <Text className="text-[14px] font-medium text-foreground">⚡ 快记一句</Text>
            </TouchableOpacity>
          </View>

          {/* 关系画像 */}
          <View className="mt-7">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-[15px] font-semibold text-foreground">AI 关系画像</Text>
              <TouchableOpacity onPress={generatePortrait} disabled={loadingPortrait} className="px-3 h-8 bg-accent-soft rounded-full items-center justify-center">
                {loadingPortrait ? <ActivityIndicator size="small" color="#E4572E" /> : <Text className="text-[12px] text-accent font-medium">{portrait ? '刷新' : '✨ 生成'}</Text>}
              </TouchableOpacity>
            </View>
            {!portrait && !loadingPortrait && (
              <Text className="text-[13px] text-muted">基于你们最近的分析记录，AI 总结 TA 的风格、雷区、吃哪套，以及给你的建议</Text>
            )}
            {loadingPortrait && (
              <View className="rounded-2xl border border-border p-4 flex-row items-center" style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}>
                <ActivityIndicator size="small" color="#E4572E" />
                <Text className="ml-3 text-[13px] text-muted">正在透视这段关系…</Text>
              </View>
            )}
            {portrait && (
              <View className="rounded-2xl bg-surface border border-border p-4">
                {!!portrait.style && (
                  <View className="mb-3">
                    <Text className="text-[11px] font-semibold text-accent mb-0.5">TA 的沟通风格</Text>
                    <Text className="text-[13px] leading-5 text-foreground">{portrait.style}</Text>
                  </View>
                )}
                {!!portrait.landmines?.length && (
                  <View className="mb-3">
                    <Text className="text-[11px] font-semibold text-danger mb-0.5">⚠️ 雷区</Text>
                    {portrait.landmines.map((x: string, i: number) => <Text key={i} className="text-[13px] leading-5 text-foreground/85">· {x}</Text>)}
                  </View>
                )}
                {!!portrait.likes?.length && (
                  <View className="mb-3">
                    <Text className="text-[11px] font-semibold text-[#3E8E41] mb-0.5">✅ 吃哪套</Text>
                    {portrait.likes.map((x: string, i: number) => <Text key={i} className="text-[13px] leading-5 text-foreground/85">· {x}</Text>)}
                  </View>
                )}
                {!!portrait.pattern && (
                  <View className="mb-3">
                    <Text className="text-[11px] font-semibold text-foreground/70 mb-0.5">关系模式</Text>
                    <Text className="text-[13px] leading-5 text-foreground">{portrait.pattern}</Text>
                  </View>
                )}
                {!!portrait.advice?.length && (
                  <View>
                    <Text className="text-[11px] font-semibold text-accent mb-0.5">给你的建议</Text>
                    {portrait.advice.map((x: string, i: number) => <Text key={i} className="text-[13px] leading-5 text-foreground/85">· {x}</Text>)}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* 快记列表 */}
          {notes.length > 0 && (
            <View className="mt-5">
              <View className="flex-row items-center justify-between mb-2">
                <Text className="text-[15px] font-semibold text-foreground">⚡ 快记</Text>
                <TouchableOpacity
                  onPress={() => router.push('/analyze', { person_id: id, person_name: person.name, prefill_note: notes.map((n) => n.text).join('\n') })}
                >
                  <Text className="text-[12px] text-accent font-medium">全部送入分析</Text>
                </TouchableOpacity>
              </View>
              {notes.slice(0, 5).map((n) => (
                <View key={n.at} className="bg-surface rounded-xl border border-border px-3.5 py-2.5 mb-2 flex-row items-center justify-between">
                  <View className="flex-1 mr-2">
                    <Text className="text-[13px] text-foreground leading-5">{n.text}</Text>
                    <Text className="text-[10px] text-muted mt-0.5">{dayjs(n.at).format('M月D日 HH:mm')}</Text>
                  </View>
                  <View className="flex-row items-center">
                    <TouchableOpacity
                      onPress={() => router.push('/analyze', { person_id: id, person_name: person.name, prefill_note: n.text })}
                      hitSlop={6}
                      className="mr-2"
                    >
                      <Text className="text-[12px] text-accent font-medium">送入分析</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteNote(n.at)} hitSlop={8}>
                      <Text className="text-[12px] text-muted">✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 关系体检 */}
          <View className="mt-7">
            <Text className="text-[15px] font-semibold text-foreground mb-3">关系体检</Text>
            <View className="flex-row flex-wrap gap-2.5">
              {[
                { label: '你主动', value: stats.myRatio != null ? `${stats.myRatio}%` : '–', sub: '聊天占比' },
                { label: '分析次数', value: String(stats.total), sub: '累计记录' },
                { label: '本周', value: `${stats.weekCount} 次`, sub: '最近 7 天' },
                { label: '温度变化', value: stats.tempChange, sub: '首末对比' },
              ].map((c, i) => (
                <View key={i} className="bg-surface rounded-2xl border border-border px-4 py-3" style={{ width: '48%' }}>
                  <Text className="text-[11px] text-muted">{c.label}</Text>
                  <Text className="text-[17px] font-bold text-foreground mt-0.5" numberOfLines={1}>{c.value}</Text>
                  <Text className="text-[10px] text-muted/70">{c.sub}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* 温度趋势 */}
          <View className="mt-7">
            <Text className="text-[15px] font-semibold text-foreground mb-3">关系温度</Text>
            {temps.length === 0 ? (
              <Text className="text-[13px] text-muted">还没有温度记录，做一次分析后这里会出现趋势</Text>
            ) : (
              <TempChart data={temps} />
            )}
            <Text className="mt-2 text-[11px] text-muted">次数越多，越能看出关系是在升温还是降温</Text>
          </View>

          {/* 重要日期 */}
          <View className="mt-7">
            <Text className="text-[15px] font-semibold text-foreground mb-3">重要日期</Text>
            {(person.dates || []).length === 0 ? (
              <Text className="text-[13px] text-muted">还没有记录重要日期</Text>
            ) : (
              (person.dates || []).map((d: any, i: number) => (
                <View key={i} className="flex-row items-center justify-between py-2 border-b border-border">
                  <Text className="text-[15px] text-foreground">{d.name}</Text>
                  <Text className="text-[15px] text-muted">{fmtDate(d.month_day)}</Text>
                </View>
              ))
            )}
          </View>

          {/* 时机提醒 */}
          {timing && (
            <View className="mt-7">
              <Text className="text-[15px] font-semibold text-foreground mb-3">⏰ 时机提醒</Text>
              <View className="rounded-2xl bg-white border border-border p-4">
                <Text className="text-[11px] text-muted mb-2">AI 从你们的对话中发现了这些可以跟进的时机</Text>
                {timing.opportunities.map((o: any, i: number) => (
                  <View key={i} className="mb-2 last:mb-0">
                    <Text className="text-[13px] font-semibold text-foreground">{o.when} · {o.what}</Text>
                    {!!o.suggestion && <Text className="text-[12px] text-muted leading-4 mt-0.5">💡 {o.suggestion}</Text>}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 时间线 */}
          <View className="mt-7">
            <Text className="text-[15px] font-semibold text-foreground mb-3">时间线</Text>
            {analyses.length === 0 ? (
              <Text className="text-[13px] text-muted">还没有分析记录</Text>
            ) : (
              analyses.map((a, idx) => (
                <SwipeRow key={`row-${a.id}`} onDelete={() => {
                  try { api.deleteAnalysis(a.id); load(); } catch (e: any) { Alert.alert('删除失败', e?.message); }
                }}>
                <TimelineCard
                  key={a.id}
                  record={a}
                  personaName={person.name}
                  first={idx === 0}
                  last={idx === analyses.length - 1}
                  expanded={!!expanded[a.id]}
                  onToggle={() => setExpanded((s) => ({ ...s, [a.id]: !s[a.id] }))}
                  onDelete={async () => {
                    try { await api.deleteAnalysis(a.id); load(); } catch (e: any) { Alert.alert('删除失败', e?.message); }
                  }}
                  onMove={async (direction: 'up' | 'down') => {
                    try { await api.moveAnalysis(a.id, direction); load(); } catch (e: any) { Alert.alert('调整失败', e?.message); }
                  }}
                  onOutcome={() => setOutcomeFor(a)}
                />
                </SwipeRow>
              ))
            )}
          </View>
        </ScrollView>
      ) : null}

      {editModal && person ? (
        <EditPersonModal
          person={person}
          onClose={() => setEditModal(false)}
          onSaved={() => { setEditModal(false); load(); }}
          onDeleted={() => { setEditModal(false); router.replace('/', {}); }}
        />
      ) : null}

      {/* 效果复盘 Modal */}
      <Modal visible={!!outcomeFor} transparent animationType="slide" onRequestClose={() => setOutcomeFor(null)}>
        <View className="flex-1 bg-black/30 justify-end">
          <View className="bg-white rounded-t-3xl p-6 pb-8">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-xl font-bold text-foreground">回复效果复盘</Text>
              <TouchableOpacity onPress={() => setOutcomeFor(null)} hitSlop={10}><Text className="text-2xl text-muted">✕</Text></TouchableOpacity>
            </View>
            <Text className="text-[12px] text-muted mb-3">把对方收到你回复后的实际回应粘贴进来，AI 会评估这条回复的效果，并给你下次的微调建议。</Text>
            <TextInput
              value={outcomeInput}
              onChangeText={setOutcomeInput}
              placeholder={`例：${person?.name || 'TA'}回了一句「好吧」，感觉还是有点勉强…`}
              placeholderTextColor="#9C9CA3"
              multiline
              className="bg-on-surface rounded-xl px-4 py-3 text-[15px] text-foreground min-h-[90px]"
            />
            <TouchableOpacity onPress={saveOutcome} disabled={savingOutcome || !outcomeInput.trim()} className="mt-4 h-12 rounded-xl bg-accent items-center justify-center">
              {savingOutcome ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold">让 AI 评估</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 快记 Modal */}
      <Modal visible={noteModal} transparent animationType="slide" onRequestClose={() => setNoteModal(false)}>
        <View className="flex-1 bg-black/30 justify-end">
          <View className="bg-surface rounded-t-3xl p-6 pb-8">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-xl font-bold text-foreground">⚡ 快记一句</Text>
              <TouchableOpacity onPress={() => setNoteModal(false)} hitSlop={10}><Text className="text-2xl text-muted">✕</Text></TouchableOpacity>
            </View>
            <Text className="text-[12px] text-muted mb-3">随手记下和 {person?.name || 'TA'} 有关的瞬间（TA 说过的话、TA 帮了你什么…），攒着以后一起分析。</Text>
            <TextInput
              value={noteInput}
              onChangeText={setNoteInput}
              placeholder="例：今天 TA 主动帮我带了饭"
              placeholderTextColor="#9C9CA3"
              multiline
              className="bg-on-surface rounded-xl px-4 py-3 text-[15px] text-foreground min-h-[90px]"
            />
            <TouchableOpacity onPress={saveNote} disabled={!noteInput.trim()} className="mt-4 h-12 rounded-xl bg-accent items-center justify-center">
              <Text className="text-white font-semibold">保存</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function fmtDate(month_day: string) {
  if (!/^\d{1,2}-\d{1,2}$/.test(month_day || '')) return month_day || '';
  const [m, d] = month_day.split('-');
  return `${+m}月${+d}日`;
}

/** 温度趋势：健康App式柔和渐变面积图（贝塞尔曲线） */
function TempChart({ data }: { data: { label: string; reason: string; created_at: string }[] }) {
  const w = 340, h = 130;
  const padTop = 14, padBottom = 16;
  const chartH = h - padTop - padBottom;
  const n = data.length;
  const lineColor = n >= 2 && TEMP_POS[data[n - 1].label] >= TEMP_POS[data[0].label] ? '#E4572E' : '#7A9BCE';

  // 生成归一化点
  const raw = data.map((d, i) => ({
    x: n === 1 ? w / 2 : (i / (n - 1)) * w,
    y: padTop + TEMP_POS[d.label] * chartH,
    label: d.label,
  }));

  // 单点：画一个小圆点 + 渐变点缀
  if (n === 1) {
    const p = raw[0];
    const color = TEMP_COLOR[p.label] || '#C9A227';
    return (
      <View className="rounded-3xl border border-border p-4" style={{ backgroundColor: 'rgba(255,253,251,0.92)' }}>
        <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
          <Defs>
            <SvgLinearGradient id="ctGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.55" />
              <Stop offset="1" stopColor={color} stopOpacity="0.05" />
            </SvgLinearGradient>
          </Defs>
          {['热', '温', '冷'].map((l) => (
            <Line key={l} x1={0} y1={padTop + TEMP_POS[l] * chartH} x2={w} y2={padTop + TEMP_POS[l] * chartH} stroke="#EFE9E2" strokeWidth={1} strokeDasharray="4 6" />
          ))}
          <Circle cx={p.x} cy={p.y} r={13} fill={color} opacity={0.2} />
          <Circle cx={p.x} cy={p.y} r={6} fill={color} />
        </Svg>
        <View className="mt-1 flex-row items-center justify-between">
          <Text className="text-[12px] font-bold" style={{ color }}>{p.label}</Text>
          <Text className="text-[11px] text-muted">最近一次{data[0].label}，{dayjs(data[0].created_at).format('M月D日')}</Text>
        </View>
      </View>
    );
  }

  // 贝塞尔平滑曲线（Catmull-Rom → 三次 Bezier）
  let d = `M ${raw[0].x} ${raw[0].y}`;
  for (let i = 0; i < raw.length - 1; i++) {
    const cur = raw[i];
    const next = raw[i + 1];
    const prev = raw[i - 1] || cur;
    const c1 = { x: cur.x + (next.x - prev.x) / 6, y: cur.y + (next.y - prev.y) / 6 };
    const n2 = raw[i + 2] || next;
    const c2 = { x: next.x - (n2.x - cur.x) / 6, y: next.y - (n2.y - cur.y) / 6 };
    d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${next.x} ${next.y}`;
  }
  const area = `${d} L ${raw[raw.length - 1].x} ${h - padBottom} L ${raw[0].x} ${h - padBottom} Z`;

  const isDown = n >= 2 && TEMP_POS[data[n - 1].label] > TEMP_POS[data[0].label];

  // 关键节点：温度发生转折的点（与上一次不同）
  const events = data
    .map((d, i) => ({ ...d, idx: i, changed: i > 0 && d.label !== data[i - 1].label }))
    .filter((d) => d.changed);
  const shownEvents = events.slice(-3);

  return (
    <View className="rounded-3xl border border-border p-4" style={{ backgroundColor: 'rgba(255,253,251,0.92)' }}>
      <Text className="text-[13px] font-semibold text-foreground mb-1">关系温度</Text>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <Defs>
          <SvgLinearGradient id="ctGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lineColor} stopOpacity="0.42" />
            <Stop offset="1" stopColor={lineColor} stopOpacity="0.02" />
          </SvgLinearGradient>
        </Defs>
        {/* 参考线（低饱和虚线） */}
        {['热', '温', '冷'].map((l) => (
          <Line key={l} x1={0} y1={padTop + TEMP_POS[l] * chartH} x2={w} y2={padTop + TEMP_POS[l] * chartH} stroke="#EFE9E2" strokeWidth={1} strokeDasharray="4 6" />
        ))}
        {/* 渐变面积 */}
        <Path d={area} fill="url(#ctGrad)" />
        {/* 平滑曲线 */}
        <Path d={d} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" />
        {/* 数据点 */}
        {raw.map((p, i) => (
          <G key={i}>
            <Circle cx={p.x} cy={p.y} r={7} fill={TEMP_COLOR[p.label] || '#C9A227'} opacity={0.22} />
            <Circle cx={p.x} cy={p.y} r={3.5} fill={TEMP_COLOR[p.label] || '#C9A227'} />
          </G>
        ))}
        {/* 转折点日期标注 */}
        {events.map((d) => {
          const p = raw[d.idx];
          return (
            <SvgText
              key={`e${d.idx}`}
              x={Math.min(Math.max(p.x, 18), w - 18)}
              y={p.y - 14}
              fontSize="9"
              fill="#9C9C9C"
              textAnchor="middle"
            >
              {dayjs(d.created_at).format('M/D')}
            </SvgText>
          );
        })}
      </Svg>
      <View className="mt-1.5 flex-row items-center justify-between">
        <Text className="text-[11px] text-muted">最近一次 · {data[data.length - 1].label}</Text>
        {isDown ? (
          <Text className="text-[11px]" style={{ color: lineColor }}>关系略降温，值得留意</Text>
        ) : (
          <Text className="text-[11px]" style={{ color: lineColor }}>关系在升温 · 很好</Text>
        )}
      </View>
      {/* 关键节点列表 */}
      {shownEvents.length > 0 && (
        <View className="mt-3 pt-3" style={{ borderTopWidth: 1, borderTopColor: '#F4F4F4' }}>
          <Text className="text-[12px] font-semibold text-foreground mb-1.5">关键节点</Text>
          {shownEvents.map((d) => (
            <View key={d.idx} className="flex-row items-start mb-1">
              <Text className="text-[11px] text-muted mr-2" style={{ minWidth: 52 }}>{dayjs(d.created_at).format('M月D日')}</Text>
              <Text className="text-[11px] font-semibold mr-1.5" style={{ color: TEMP_COLOR[d.label] }}>{data[d.idx - 1].label}→{d.label}</Text>
              <Text className="flex-1 text-[11px] text-muted leading-4" numberOfLines={1}>{d.reason || ''}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** 时间线卡片 */
/** iMessage 质感聊天气泡 */
function ChatBubbles({ text }: { text: string }) {
  const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const msgs: { me: boolean; content: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^(我|对方|ta|Ta|TA)[:：](.*)$/);
    if (m) {
      msgs.push({ me: m[1] === '我', content: m[2] });
    } else {
      // 无法识别说话者的原始行：并入上一条，或作为对方消息兜底
      if (msgs.length) msgs[msgs.length - 1].content += '\n' + line;
      else msgs.push({ me: false, content: line });
    }
  }
  if (!msgs.length) return null;
  return (
    <View>
      {msgs.map((msg, i) => (
        <View key={i} className={`flex-row mb-2 ${msg.me ? 'justify-end' : 'justify-start'}`}>
          <View
            className={`px-3.5 py-2 max-w-[82%] ${msg.me ? 'rounded-[18px] rounded-br-[6px]' : 'rounded-[18px] rounded-bl-[6px]'}`}
            style={{ backgroundColor: msg.me ? '#95EC69' : '#FFFFFF', borderWidth: 1, borderColor: msg.me ? '#86DB5B' : '#EFE9E2' }}
          >
            <Text className={`text-[13px] leading-5 ${msg.me ? 'text-foreground' : 'text-foreground'}`}>{msg.content}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function TimelineCard({ record, personaName, first, last, expanded, onToggle, onDelete, onMove, onOutcome }: any) {
  const status = record.status;
  const res = record.result || {};
  const running = status === 'gen';
  return (
    <View className="bg-surface rounded-2xl border border-border mb-3 overflow-hidden">
      <TouchableOpacity onPress={onToggle} className="px-4 py-3 flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: TEMP_COLOR[record.temp_label] || '#CCC' }} />
          <Text className="ml-2.5 text-[13px] text-foreground font-medium">
            {running ? '分析生成中…' : dayjs(record.created_at).format('M月D日 HH:mm')}
          </Text>
        </View>
        <Text className="text-[12px] text-muted">{expanded ? '收起' : '展开'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View className="px-4 pb-4">
          {running ? (
            <View className="flex-row items-center py-2">
              <ActivityIndicator size="small" color="#666" />
              <Text className="ml-2 text-[13px] text-muted">AI 正在思考……</Text>
            </View>
          ) : status === 'failed' ? (
            <Text className="text-[13px] text-danger py-2">分析失败，请稍后再试</Text>
          ) : (
            <View className="space-y-3">
              {!!record.chat_input && (
                <View>
                  <Text className="text-[12px] text-muted mb-1.5">聊天记录</Text>
                  <View className="bg-on-surface rounded-2xl px-3 py-3">
                    <ChatBubbles text={record.chat_input} />
                  </View>
                </View>
              )}
              {!!record.thought_input && (
                <View>
                  <Text className="text-[12px] text-muted mb-1">我的想法</Text>
                  <Text className="text-[13px] text-foreground leading-5">{record.thought_input}</Text>
                </View>
              )}
              {/* 对面在想什么 */}
              {(res.thoughts || []).length > 0 && (
                <View>
                  <Text className="text-[12px] text-muted mb-1">对面在想什么</Text>
                  {(res.thoughts || []).map((t: any, i: number) => (
                    <View key={i} className="mb-1.5">
                      <Text className="text-[13px] text-foreground font-medium">· {t.point}</Text>
                      {!!t.evidence && <Text className="text-[12px] text-muted mt-0.5">  {t.evidence}</Text>}
                    </View>
                  ))}
                </View>
              )}
              {/* 建议回复 */}
              {(res.suggestions || []).length > 0 && (
                <View>
                  <Text className="text-[12px] text-muted mb-1">建议回复</Text>
                  {(res.suggestions || []).map((s: any, i: number) => (
                    <View key={i} className="mb-1.5">
                      <Text className="text-[12px] text-accent">〔{s.style}〕</Text>
                      <Text className="text-[13px] text-foreground leading-5">{s.text}</Text>
                      {!!s.reason && <Text className="text-[12px] text-muted mt-0.5">  {s.reason}</Text>}
                    </View>
                  ))}
                </View>
              )}
              {(res.notes || []).length > 0 && (
                <View>
                  <Text className="text-[12px] text-muted mb-1">注意事项</Text>
                  {(res.notes || []).map((nt: string, i: number) => (
                    <Text key={i} className="text-[13px] text-foreground leading-5">{nt}</Text>
                  ))}
                </View>
              )}
              {!!res.stage_tip && (
                <View className="mt-2 rounded-2xl border border-accent/30 bg-accent/10 px-3.5 py-3">
                  <Text className="text-[12px] font-bold text-accent">下一步 · {res.stage_tip.stage_now || '阶段建议'}</Text>
                  {!!res.stage_tip.next && <Text className="mt-1 text-[13px] leading-5 text-foreground/85">{res.stage_tip.next}</Text>}
                  {!!res.stage_tip.actions?.length && (
                    <View className="mt-1.5">
                      {res.stage_tip.actions.map((a: string, i: number) => (
                        <Text key={i} className="text-[12.5px] leading-5 text-foreground/75">□ {a}</Text>
                      ))}
                    </View>
                  )}
                </View>
              )}
              {!!res.baguan && !!res.baguan.observations?.length && (
                <View className="mt-2 rounded-2xl border border-border bg-white px-3.5 py-3">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-[12px] font-bold text-foreground">☰ 八观识人 · 人物速评</Text>
                    <View className="px-2 py-0.5 rounded-full bg-on-surface">
                      <Text className="text-[10.5px] text-muted">置信度 {res.baguan.confidence || '低'}</Text>
                    </View>
                  </View>
                  {!!res.baguan.verdict && (
                    <Text className="mt-1 text-[13px] leading-5 text-foreground font-semibold">{res.baguan.verdict}</Text>
                  )}
                  <View className="mt-1.5">
                    {res.baguan.observations.map((o: any, i: number) => (
                      <Text key={i} className="text-[12.5px] leading-5 text-foreground/85 mt-1">
                        <Text className="font-semibold text-accent">{o.dim ? `${o.dim} · ` : ''}</Text>{o.point}
                      </Text>
                    ))}
                  </View>
                  {!!res.baguan.caveat && (
                    <Text className="mt-1.5 text-[11px] leading-4 text-muted">⚠ {res.baguan.caveat}</Text>
                  )}
                </View>
              )}
              {(() => {
                const outcome = record.result?.outcome;
                const usedAny = Object.values(record.result?.marks || {}).some(Boolean);
                const color = outcome?.effect === '好' ? '#3E8E41' : outcome?.effect === '翻车' ? '#E4572E' : '#C9A227';
                if (outcome) {
                  return (
                    <View className="mt-2 rounded-xl border border-border bg-on-surface px-3 py-2.5">
                      <View className="flex-row items-center">
                        <Text className="text-[12px] font-bold" style={{ color }}>效果：{outcome.effect}</Text>
                        {!!outcome.reason && <Text className="ml-2 text-[11px] text-muted flex-1" numberOfLines={2}>{outcome.reason}</Text>}
                      </View>
                      {!!outcome.lesson && <Text className="mt-1 text-[11px] text-foreground/75 leading-4">💡 {outcome.lesson}</Text>}
                    </View>
                  );
                }
                if (record.status === 'done') {
                  return (
                    <View className="mt-2 gap-2">
                      {usedAny && (
                        <TouchableOpacity onPress={onOutcome} className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
                          <Text className="text-[12px] text-accent font-medium">📨 记录对方的回应，评估这条回复的效果</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={async () => {
                          try { await downloadDocx(`/api/v1/analysis/${record.id}/docx`, `沟通分析报告-${dayjs(record.created_at).format('M月D日')}.docx`); Alert.alert('已导出', 'Word 文档已下载'); }
                          catch (e: any) { Alert.alert('导出失败', e?.message); }
                        }}
                        className="rounded-xl border border-border bg-on-surface px-3 py-2"
                      >
                        <Text className="text-[12px] text-foreground/80 font-medium">📝 导出 Word 文档</Text>
                      </TouchableOpacity>
                    </View>
                  );
                }
                return null;
              })()}
              <View className="pt-2 border-t border-[#F4F4F4] flex-row items-center justify-between">
                <Text className="text-[12px] text-muted flex-1" numberOfLines={1}>
                  温度：{record.temp_label}  {record.temp_reason}
                </Text>
                <View className="flex-row items-center">
                  <TouchableOpacity onPress={() => onMove('up')} disabled={first} hitSlop={6} className="px-2">
                    <Text className={`text-[13px] px-1.5 py-1 ${first ? 'text-muted/40' : 'text-muted'}`}>↑ 上移</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onMove('down')} disabled={last} hitSlop={6} className="px-2">
                    <Text className={`text-[13px] px-1.5 py-1 ${last ? 'text-muted/40' : 'text-muted'}`}>↓ 下移</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={onDelete} hitSlop={8} className="px-2">
                    <Text className="text-[13px] text-danger px-1.5 py-1">删除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/** 编辑档案 Modal（复用字段） */
function EditPersonModal({ person, onClose, onSaved, onDeleted }: any) {
  const [form, setForm] = useState({
    name: person.name,
    relationship: person.relationship || '',
    background: person.background || '',
    avatar_color: person.avatar_color || AVATAR_COLORS[0],
    dates: (person.dates || []).map((d: any) => ({ name: d.name, month_day: d.month_day })),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updatePerson(person.id, {
        name: form.name.trim(),
        relationship: form.relationship.trim(),
        background: form.background.trim(),
        avatar_color: form.avatar_color,
        dates: form.dates.filter((d: any) => d.name.trim() && /^\d{1,2}-\d{1,2}$/.test(d.month_day)),
      });
      onSaved();
    } catch (e: any) { Alert.alert('保存失败', e?.message); } finally { setSaving(false); }
  };

  const delPerson = () => {
    Alert.alert(`删除「${person.name}」`, '将删除该人物全部数据，无法恢复。确定？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => { try { await api.deletePerson(person.id); onDeleted(); } catch (e: any) { Alert.alert('删除失败', e?.message); } } },
    ]);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/30 justify-end">
        <View className="bg-surface rounded-t-3xl p-6 pb-8 max-h-[88%]">
          <View className="flex-row items-center justify-between mb-5">
            <Text className="text-xl font-bold text-foreground">编辑档案</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><Text className="text-2xl text-muted">✕</Text></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Field label="称呼"><TextInput value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} placeholder="称呼" placeholderTextColor="#C9C9C9" className="bg-on-surface rounded-xl px-4 h-12 text-base text-foreground" /></Field>
            <Field label="关系"><TextInput value={form.relationship} onChangeText={(t) => setForm({ ...form, relationship: t })} placeholder="关系" placeholderTextColor="#C9C9C9" className="bg-on-surface rounded-xl px-4 h-12 text-base text-foreground" /></Field>
            <Field label="头像颜色圆点">
              <View className="flex-row flex-wrap gap-3">
                {AVATAR_COLORS.map((c) => (
                  <TouchableOpacity key={c} onPress={() => setForm({ ...form, avatar_color: c })} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c, alignItems: 'center', justifyContent: 'center' }}>
                    {form.avatar_color === c && <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFFFFF' }} />}
                  </TouchableOpacity>
                ))}
              </View>
            </Field>
            <Field label="背景备注"><TextInput value={form.background} onChangeText={(t) => setForm({ ...form, background: t })} placeholder="性格/聊天风格/当前阶段" placeholderTextColor="#C9C9C9" multiline className="bg-on-surface rounded-xl px-4 py-3 text-base text-foreground min-h-[80px]" /></Field>
            <Text className="text-[13px] text-muted mb-1.5">重要日期</Text>
            {(form.dates || []).map((d: any, i: number) => (
              <View key={i} className="flex-row items-center mb-2 space-x-2">
                <TextInput value={d.name} onChangeText={(t) => setForm({ ...form, dates: form.dates.map((x: any, idx: number) => idx === i ? { ...x, name: t } : x) })} placeholder="如：生日" placeholderTextColor="#C9C9C9" className="flex-1 bg-on-surface rounded-xl px-4 h-11 text-[15px] text-foreground" />
                <TextInput value={d.month_day} onChangeText={(t) => setForm({ ...form, dates: form.dates.map((x: any, idx: number) => idx === i ? { ...x, month_day: t } : x) })} placeholder="月-日" placeholderTextColor="#C9C9C9" className="w-24 bg-on-surface rounded-xl px-2 h-11 text-[15px] text-foreground text-center" />
                <TouchableOpacity onPress={() => setForm({ ...form, dates: form.dates.filter((_: any, idx: number) => idx !== i) })} hitSlop={8}><Text className="text-danger">✕</Text></TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity onPress={() => setForm({ ...form, dates: [...form.dates, { name: '', month_day: '' }] })}><Text className="text-accent text-[13px]">＋ 添加日期</Text></TouchableOpacity>
          </ScrollView>
          <TouchableOpacity onPress={delPerson} className="mt-3 self-center"><Text className="text-[13px] text-danger">删除此人物档案</Text></TouchableOpacity>
          <View className="flex-row space-x-3 mt-3">
            <TouchableOpacity onPress={onClose} className="flex-1 h-12 rounded-xl bg-on-surface items-center justify-center"><Text className="text-foreground font-medium">取消</Text></TouchableOpacity>
            <TouchableOpacity onPress={save} disabled={saving} className="flex-1 h-12 rounded-xl bg-foreground items-center justify-center"><Text className="text-white font-medium">{saving ? '保存中…' : '保存'}</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, children }: any) {
  return <View className="mb-4"><Text className="text-[13px] text-muted mb-1.5">{label}</Text>{children}</View>;
}