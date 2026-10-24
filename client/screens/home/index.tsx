import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, TextInput, ScrollView, FlatList, Alert, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { api } from '@/utils/api';
import { useAuth } from '@/contexts/AuthContext';
import { evaluateDateReminders, type UpcomingDate } from '@/utils/reminder';
import dayjs from 'dayjs';

type Person = any;
type DateItem = { name: string; month_day: string };

const EMPTY_FORM = { name: '', relationship: '', background: '', avatar_color: '#FF7A5C', dates: [] as DateItem[] };
const AVATAR_COLORS_HOME = ['#FF7A5C', '#7A9BCE', '#C9A227', '#6FB98F', '#C084FC', '#E4572E', '#5AA9E6'];
const RELATIONSHIP_CHIPS = ['朋友', '同学', '同事', '家人', '恋人', '老师', '客户'];
const PINNED_KEY = 'echo_mentor_pinned_ids';

/**
 * 人物列表页（首页 Tab）
 * - 档案卡片：称呼 + 关系 + 最近互动时间
 * - 置顶（本地存储）/ 关系筛选 / 搜索 / 下拉刷新
 * - 新增 / 编辑 / 删除（内嵌 Modal）
 */
export default function HomeScreen() {
  const router = useSafeRouter();
  const { isUnlocked } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // AI 快速建档：粘贴一段聊天 → AI 自动填称呼/关系/背景
  const [aiText, setAiText] = useState('');
  const [aiFilling, setAiFilling] = useState(false);
  const aiFill = async () => {
    if (!aiText.trim() || aiFilling) return;
    setAiFilling(true);
    try {
      const p = await api.extractProfile(aiText);
      const filled: string[] = [];
      setForm((f) => {
        const next = { ...f };
        if (p.name?.trim()) { next.name = p.name.trim(); filled.push('称呼'); }
        if (p.relationship?.trim()) { next.relationship = p.relationship.trim(); filled.push('关系'); }
        if (p.background?.trim()) { next.background = p.background.trim(); filled.push('背景'); }
        if (p.dates?.length) {
          next.dates = [
            ...f.dates.filter((d) => d.name.trim() || d.month_day.trim()),
            ...p.dates.map((d) => ({ name: d.name, month_day: d.month_day })),
          ];
          filled.push('重要日期');
        }
        return next;
      });
      Alert.alert(
        filled.length ? 'AI 填好了' : 'AI 没认出什么',
        filled.length
          ? `已帮你填好：${filled.join('、')}。往下翻核对一下，改完保存即可。`
          : '这段聊天里看不出称呼/关系等信息。你可以只参考它写「背景备注」，或直接手动填。'
      );
    } catch (e: any) {
      Alert.alert('AI 填充失败', `${e?.message ?? '请稍后重试'}`);
    } finally {
      setAiFilling(false);
    }
  };
  const [reminders, setReminders] = useState<UpcomingDate[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [filterRel, setFilterRel] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [reorderMode, setReorderMode] = useState(false);
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const load = useCallback(async (showSpinner = false) => {
    if (!isUnlocked) return;
    if (showSpinner) setRefreshing(true);
    try {
      const data = await api.people();
      setPeople(data || []);
    } catch (e: any) {
      Alert.alert('加载失败', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isUnlocked]);

  // 置顶列表存本地（不改数据库结构）
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        setPinned(JSON.parse((await AsyncStorage.getItem(PINNED_KEY)) || '[]'));
        setOrderIds(JSON.parse((await AsyncStorage.getItem('echo_mentor_order_ids')) || '[]'));
      } catch { /* ignore */ }
      load();
    })();
  }, [load]));

  const persistOrder = async (ids: string[]) => {
    setOrderIds(ids);
    try { await AsyncStorage.setItem('echo_mentor_order_ids', JSON.stringify(ids)); } catch { /* ignore */ }
  };
  const moveCard = (id: string, dir: 'up' | 'down') => {
    const ids = visible.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    persistOrder(ids);
  };

  const togglePin = async (id: string) => {
    const next = pinned.includes(id) ? pinned.filter((x) => x !== id) : [...pinned, id];
    setPinned(next);
    try { await AsyncStorage.setItem(PINNED_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  // 筛选 + 排序：置顶优先，其余按最近互动
  const relationships = Array.from(new Set(people.map((p) => p.relationship).filter(Boolean)));
  const visible = people
    .filter((p) => (filterRel ? p.relationship === filterRel : true))
    .filter((p) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (p.name || '').toLowerCase().includes(q) || (p.relationship || '').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const pa = pinned.includes(a.id) ? 0 : 1;
      const pb = pinned.includes(b.id) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ia = orderIds.indexOf(a.id), ib = orderIds.indexOf(b.id);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return (b.last_interaction_at || '').localeCompare(a.last_interaction_at || '');
    });

  // 重要日期提醒（提前 3 天浏览器通知 + 页面横幅）
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const list = await api.upcomingDates();
        const due = await evaluateDateReminders(list || []);
        setReminders(due);
      } catch { /* ignore */ }
    })();
  }, []));

  const formatInteraction = (t?: string) => {
    if (!t) return '还没有分析记录';
    return `最近互动 ${dayjs(t).format('M月D日 HH:mm')}`;
  };

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };
  const openEdit = (p: Person) => {
    setEditing(p);
    setForm({
      name: p.name,
      relationship: p.relationship || '',
      background: p.background || '',
      avatar_color: p.avatar_color || '#FF7A5C',
      dates: (p.dates || []).map((d: any) => ({ name: d.name, month_day: d.month_day })),
    });
    setShowModal(true);
  };

  const confirmDelete = (p: Person) => {
    Alert.alert(`删除「${p.name}」`, '将同时删除该人物的所有分析与时间线，且无法恢复。确定删除？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => { try { await api.deletePerson(p.id); load(); } catch (e: any) { Alert.alert('删除失败', e?.message); } } },
    ]);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { Alert.alert('提示', '请填写称呼'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        relationship: form.relationship.trim(),
        background: form.background.trim(),
        avatar_color: form.avatar_color,
        dates: form.dates.filter((d) => d.name.trim() && /^\d{1,2}-\d{1,2}$/.test(d.month_day)),
      };
      if (editing) {
        const patch: any = { name: payload.name, relationship: payload.relationship, background: payload.background, avatar_color: payload.avatar_color };
        await api.updatePerson(editing.id, { ...patch, dates: payload.dates });
      }
      else await api.createPerson(payload);
      setShowModal(false);
      load();
    } catch (e: any) {
      Alert.alert('保存失败', e?.message);
    } finally {
      setSaving(false);
    }
  };

  const updateDate = (i: number, patch: Partial<DateItem>) => {
    setForm((f) => {
      const dates = f.dates.map((d, idx) => (idx === i ? { ...d, ...patch } : d));
      return { ...f, dates };
    });
  };

  // 渲染
  if (!isUnlocked) return null;

  return (
    <Screen safeAreaEdges={['top', 'left', 'right', 'bottom']}>
      {/* Header：大标题（主操作移至右下角 FAB，遵循 Material 3「一屏一主操作」） */}
      <View className="px-6 pt-4 pb-2 flex-row items-end justify-between">
        <View className="flex-1">
          <Text className="text-3xl font-bold text-foreground tracking-tight">人物</Text>
          <Text className="mt-1 text-[13px] text-muted">你关心的人，值得想清楚再回应</Text>
        </View>
        {people.length > 1 && (
          <TouchableOpacity
            onPress={() => setReorderMode((v) => !v)}
            className={`px-3.5 h-9 rounded-full items-center justify-center ${reorderMode ? 'bg-accent' : 'bg-surface border border-border'}`}
          >
            <Text className={`text-[12.5px] font-medium ${reorderMode ? 'text-white' : 'text-foreground/70'}`}>
              {reorderMode ? '✓ 完成' : '⇅ 排序'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 搜索框（iOS 风格灰底圆角） */}
      <View className="px-5 pb-2">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="搜索称呼或关系…"
          placeholderTextColor="#9C9CA3"
          className="bg-on-surface rounded-xl px-4 h-10 text-[15px] text-foreground"
        />
      </View>

      {/* 关系筛选 chips */}
      {relationships.length > 0 && (
        <View className="pb-2">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
            <TouchableOpacity
              onPress={() => setFilterRel(null)}
              className={`px-4 h-9 rounded-full items-center justify-center ${filterRel === null ? 'bg-foreground' : 'bg-surface border border-border'}`}
            >
              <Text className={`text-[13.5px] ${filterRel === null ? 'text-white font-medium' : 'text-foreground/70'}`}>全部</Text>
            </TouchableOpacity>
            {relationships.map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setFilterRel(filterRel === r ? null : r)}
                className={`px-4 h-9 rounded-full items-center justify-center ${filterRel === r ? 'bg-accent' : 'bg-surface border border-border'}`}
              >
                <Text className={`text-[13.5px] ${filterRel === r ? 'text-white font-medium' : 'text-foreground/70'}`}>{r}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {reminders.length > 0 && (
        <View className="mx-5 mb-2 bg-[#FFF7E6] border border-[#F2E1B3] rounded-2xl px-4 py-3">
          <View className="flex-row items-center mb-1">
            <Text className="text-[14px] mr-1.5">🔔</Text>
            <Text className="text-[12px] font-semibold text-[#8A6D1D]">重要日期提醒</Text>
          </View>
          {reminders.map((r) => (
            <Text key={r.id} className="text-[13px] text-[#6B5513] leading-5">
              {r.date} 是 {r.person_name}的{r.name}（还有 {r.remind_in} 天），要不要主动问候？
            </Text>
          ))}
        </View>
      )}

      <View style={{ flex: 1, overflow: 'hidden' }}>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 }}
        ListEmptyComponent={
          query.trim() || filterRel ? (
            <View className="items-center pt-14 px-8">
              <Text className="text-[15px] text-muted">没有匹配的人物</Text>
              <TouchableOpacity onPress={() => { setQuery(''); setFilterRel(null); }} className="mt-3">
                <Text className="text-[13px] text-accent font-medium">清除筛选</Text>
              </TouchableOpacity>
            </View>
          ) : (
          <View className="items-center pt-14 px-8">
            <View className="w-16 h-16 rounded-3xl bg-accent-soft items-center justify-center mb-4">
              <Text className="text-3xl">👋</Text>
            </View>
            <Text className="text-lg text-foreground font-semibold">还没有人物档案</Text>
            <Text className="mt-2 text-center text-[13px] text-muted leading-5">
              先新增一位你想认真维系的人{'\n'}下一次聊天后，点「开始分析」就能帮我理解对话
            </Text>
            <TouchableOpacity onPress={openAdd} className="mt-6 bg-accent px-6 h-11 rounded-full items-center justify-center">
              <Text className="text-white font-semibold">＋ 创建第一个人物</Text>
            </TouchableOpacity>
          </View>
          )
        }
        renderItem={({ item }) => (
          <View className="bg-surface rounded-2xl px-4 py-4 mb-3 border border-border">
            {/* 卡片主体：点头像区进详情 */}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => router.push('/person', { id: item.id })}
              className="flex-row items-center"
            >
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: item.avatar_color || '#FF7A5C', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Text className="text-lg font-bold text-white">{item.name?.charAt(0)}</Text>
              </View>
              <View className="flex-1">
                <View className="flex-row items-center">
                  <Text className="text-lg font-semibold text-foreground">{item.name}</Text>
                  {!!item.relationship && (
                    <View className="ml-2 px-2 py-0.5 rounded-full bg-[#F4F4F4]">
                      <Text className="text-[11px] text-muted">{item.relationship}</Text>
                    </View>
                  )}
                </View>
                <Text className="mt-1 text-[11px] text-muted">{formatInteraction(item.last_interaction_at)}</Text>
              </View>
            </TouchableOpacity>

            {/* 操作区：主 CTA 醒目（去分析），次级操作弱化（置顶/编辑/删除）；排序模式显示 ↑↓ */}
            <View className="flex-row items-center justify-between mt-3 pt-3" style={{ borderTopWidth: 1, borderTopColor: '#F7F7F7' }}>
              {reorderMode ? (
                <View className="flex-1 flex-row items-center justify-between">
                  <Text className="text-[12px] text-muted">拖动排序模式</Text>
                  <View className="flex-row items-center gap-2">
                    <TouchableOpacity onPress={() => moveCard(item.id, 'up')} className="px-3 h-9 bg-on-surface rounded-full items-center justify-center">
                      <Text className="text-[14px] text-foreground">↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => moveCard(item.id, 'down')} className="px-3 h-9 bg-on-surface rounded-full items-center justify-center">
                      <Text className="text-[14px] text-foreground">↓</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <>
                  <View className="flex-row items-center">
                    <TouchableOpacity onPress={() => togglePin(item.id)} hitSlop={10} className="px-2.5 h-9 items-center justify-center">
                      <Text className="text-[13px]">{pinned.includes(item.id) ? '📌 已置顶' : '📌'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => openEdit(item)} hitSlop={10} className="px-2.5 h-9 items-center justify-center">
                      <Text className="text-[13px] text-muted">编辑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => confirmDelete(item)} hitSlop={10} className="px-2.5 h-9 items-center justify-center">
                      <Text className="text-[13px] text-danger">删除</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => router.push('/analyze', { person_id: item.id, person_name: item.name })}
                    className="bg-accent px-5 h-10 rounded-full flex-row items-center"
                    activeOpacity={0.8}
                  >
                    <Text className="text-white font-semibold text-[14px]">💬 开始分析</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}
      />
      </View>

      {/* Material 3 Extended FAB：页面唯一主操作 */}
      <TouchableOpacity
        onPress={openAdd}
        activeOpacity={0.85}
        className="absolute right-5 bottom-[104px] h-14 px-5 rounded-2xl bg-accent flex-row items-center"
        style={{ shadowColor: '#E4572E', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 }}
      >
        <Text className="text-white text-[24px] font-light mr-1.5" style={{ marginTop: -2 }}>＋</Text>
        <Text className="text-white font-semibold text-[15px]">新增人物</Text>
      </TouchableOpacity>

      {/* 档案 Modal */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View className="flex-1 bg-black/30 justify-end">
          <View className="bg-surface rounded-t-3xl p-6 pb-8 max-h-[88%]">
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-xl font-bold text-foreground">{editing ? '编辑档案' : '新增人物'}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} hitSlop={10}>
                <Text className="text-2xl text-muted">✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {/* AI 快速建档（懒人建法） */}
              {!editing && (
                <View className="bg-on-surface rounded-2xl p-4 mb-5">
                  <Text className="text-[14px] font-semibold text-foreground mb-1">✨ 懒人建法</Text>
                  <Text className="text-[12px] text-muted mb-2 leading-4">粘贴一段和 TA 的聊天记录，AI 自动帮你填称呼、关系和背景备注。</Text>
                  <TextInput
                    value={aiText}
                    onChangeText={setAiText}
                    placeholder={'从微信长按消息→多选→合并转发→复制，整段粘到这里。\n带昵称、时间戳都没关系，AI 会自动忽略。'}
                    placeholderTextColor="#C9C9C9"
                    multiline
                    className="bg-surface rounded-xl border border-border px-3 py-2.5 text-[14px] text-foreground min-h-[110px] mb-2"
                  />
                  <TouchableOpacity
                    onPress={aiFill}
                    disabled={aiFilling || !aiText.trim()}
                    className="h-9 rounded-full bg-accent items-center justify-center self-start px-4"
                  >
                    {aiFilling ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text className="text-white text-[13px] font-semibold">AI 帮我填档案</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
              <Text className="text-[13px] text-muted mb-1.5">怎么称呼这个人？<Text className="text-danger">*</Text></Text>
              <TextInput
                value={form.name}
                onChangeText={(t) => setForm({ ...form, name: t })}
                placeholder="如：安安 / 张老师"
                placeholderTextColor="#C9C9C9"
                className="bg-on-surface rounded-xl px-4 h-12 text-base text-foreground mb-4"
              />
              <Text className="text-[13px] text-muted mb-1.5">关系<Text className="text-muted/60">（选填）</Text></Text>
              <View className="flex-row flex-wrap mb-2">
                {RELATIONSHIP_CHIPS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setForm({ ...form, relationship: r })}
                    className={`px-3 h-8 rounded-full items-center justify-center mr-2 mb-2 ${form.relationship === r ? 'bg-accent' : 'bg-on-surface'}`}
                  >
                    <Text className={`text-[13px] ${form.relationship === r ? 'text-white font-medium' : 'text-foreground/70'}`}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                value={form.relationship}
                onChangeText={(t) => setForm({ ...form, relationship: t })}
                placeholder="也可以自己写，如：打球认识的 / 表姐"
                placeholderTextColor="#C9C9C9"
                className="bg-on-surface rounded-xl px-4 h-12 text-base text-foreground mb-4"
              />
              <Text className="text-[13px] text-muted mb-1.5">头像颜色</Text>
              <View className="flex-row flex-wrap mb-4">
                {AVATAR_COLORS_HOME.map((c) => (
                  <TouchableOpacity key={c} onPress={() => setForm({ ...form, avatar_color: c })} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c, marginRight: 10, alignItems: 'center', justifyContent: 'center' }}>
                    {form.avatar_color === c && <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: '#FFFFFF' }} />}
                  </TouchableOpacity>
                ))}
              </View>
              <Text className="text-[13px] text-muted mb-1.5">背景备注<Text className="text-muted/60">（选填）</Text></Text>
              <TextInput
                value={form.background}
                onChangeText={(t) => setForm({ ...form, background: t })}
                placeholder="想到什么写什么，帮 AI 更懂这个人。如：外向爱开玩笑，最近在忙提案"
                placeholderTextColor="#C9C9C9"
                multiline
                className="bg-on-surface rounded-xl px-4 py-3 text-base text-foreground min-h-[90px] mb-4"
              />
              <Text className="text-[12px] text-muted/80 mb-4">只填称呼就能保存，其他以后随时补。</Text>

              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-[13px] text-muted">重要日期（选填）</Text>
                <TouchableOpacity
                  onPress={() => setForm({ ...form, dates: [...form.dates, { name: '', month_day: '' }] })}
                >
                  <Text className="text-accent text-[13px] font-medium">＋ 添加</Text>
                </TouchableOpacity>
              </View>
              {form.dates.length === 0 && (
                <Text className="text-[12px] text-muted/80 mb-2">生日、纪念日…提前 3 天会提醒你。</Text>
              )}
              {form.dates.map((d, i) => (
                <View key={i} className="flex-row items-center mb-2 space-x-2">
                  <TextInput
                    value={d.name}
                    onChangeText={(t) => updateDate(i, { name: t })}
                    placeholder="如：生日"
                    placeholderTextColor="#C9C9C9"
                    className="flex-1 bg-on-surface rounded-xl px-4 h-11 text-[15px] text-foreground"
                  />
                  <TextInput
                    value={d.month_day}
                    onChangeText={(t) => updateDate(i, { month_day: t })}
                    placeholder="月-日"
                    placeholderTextColor="#C9C9C9"
                    className="w-28 bg-on-surface rounded-xl px-3 h-11 text-[15px] text-foreground text-center"
                  />
                  <TouchableOpacity onPress={() => setForm({ ...form, dates: form.dates.filter((_, idx) => idx !== i) })} hitSlop={8}>
                    <Text className="text-danger">✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>

            <View className="flex-row space-x-3 mt-4">
              <TouchableOpacity
                onPress={() => setShowModal(false)}
                className="flex-1 h-12 rounded-xl bg-on-surface items-center justify-center"
              >
                <Text className="text-foreground font-medium">取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                className="flex-1 h-12 rounded-xl bg-foreground items-center justify-center"
              >
                <Text className="text-white font-medium">{saving ? '保存中…' : '保存'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}