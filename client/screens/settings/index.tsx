import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, TextInput, Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Pressable } from 'react-native';
import { Screen } from '@/components/Screen';
import { api } from '@/utils/api';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getDsKey, setDsKey } from '@/utils/deepseek';

const APPEARANCES = ["light", "dark", "system"] as const;
const APPEARANCE_LABEL: Record<string, string> = { light: '浅色', dark: '深色', system: '跟随系统' };

const MODES = [
  { key: 'canned', title: '话术模式', desc: '给完整建议句子（默认）' },
  { key: 'hint', title: '提示模式', desc: '只给思路方向，不给原话' },
  { key: 'critique', title: '点评模式', desc: '你写下回复，AI 只点评不代写' },
] as const;

/**
 * 设置页：成长模式三档 + 节制提醒开关 + 修改 PIN + 锁定 + 隐私说明
 */
export default function SettingsScreen() {
  const [growthMode, setGrowthMode] = useState<string>('canned');
  const [moderation, setModeration] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const { lock, initialized: authInitialized, disableLock } = useAuth();

  const hasPin = !!(authInitialized);

  // DeepSeek 「自带钥匙」状态
  const [dsKey, setDsKeyState] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyEditing, setKeyEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { themeMode, setThemeMode } = useTheme();

  // 导出全部数据：人物 + 各人物分析记录 + 周报（Web 端下载 JSON，原生端走系统分享）
  const exportData = async () => {
    setExporting(true);
    try {
      const people = (await api.people()) || [];
      const analyses: any[] = [];
      for (const p of people) {
        try {
          const list = await api.personAnalyses(p.id);
          for (const a of list || []) analyses.push({ ...a, person_name: p.name });
        } catch { /* 单人失败不影响整体 */ }
      }
      let reports: any[] = [];
      try { reports = (await api.reports()) || []; } catch { /* ignore */ }
      const payload = {
        exported_at: new Date().toISOString(),
        version: 1,
        people,
        analyses,
        reports,
      };
      const json = JSON.stringify(payload, null, 2);
      const filename = `echo-mentor-backup-${new Date().toISOString().slice(0, 10)}.json`;
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        Alert.alert('已导出', `${filename} 已开始下载（${people.length} 位人物、${analyses.length} 条分析记录）`);
      } else {
        Alert.alert('已生成', `共 ${people.length} 位人物、${analyses.length} 条分析记录。原生端导出文件功能即将上线。`);
      }
    } catch (e: any) {
      Alert.alert('导出失败', e?.message);
    } finally {
      setExporting(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const s = await api.settings();
      if (s?.growth_mode) setGrowthMode(s.growth_mode);
      if (typeof s?.moderation === 'boolean') setModeration(s.moderation);
    } catch { /* ignore */ }
    setDsKeyState(await getDsKey());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const changeMode = async (key: string) => {
    setGrowthMode(key);
    setLoading(true);
    try { await api.updateSettings({ growth_mode: key }); } catch (e: any) { Alert.alert('保存失败', e?.message); } finally { setLoading(false); }
  };

  const toggleModeration = async (v: boolean) => {
    setModeration(v);
    try { await api.updateSettings({ moderation: v }); } catch (e: any) { setModeration(!v); Alert.alert('保存失败', e?.message); }
  };

  const saveKey = async () => {
    const k = keyInput.trim();
    if (!k) { await setDsKey(''); setDsKeyState(''); setKeyInput(''); setKeyEditing(false); Alert.alert('已移除', '已改用内置分析服务'); return; }
    if (!k.startsWith('sk-') && k.length < 20) { Alert.alert('提示', '请输入有效的 DeepSeek API Key'); return; }
    try {
      await setDsKey(k);
      setDsKeyState(k);
      setKeyInput('');
      setKeyEditing(false);
      Alert.alert('已保存', '密钥仅保存在本机，分析将由 App 直连 api.deepseek.com 完成（更稳定、不依赖后端网络）。');
    } catch (e: any) { Alert.alert('保存失败', e?.message); }
  };

  const maskKey = (k: string) => (k && k.length > 6 ? `${k.slice(0, 3)}····${k.slice(-4)}` : k || '');

  const savePin = async () => {
    if (!/^\d{4}$/.test(pinInput)) { Alert.alert('提示', '请输入 4 位数字 PIN'); return; }
    try {
      await api.updateSettings({ pin: pinInput });
      setShowPin(false); setPinInput('');
      Alert.alert('已更新', '新的 PIN 已生效');
    } catch (e: any) { Alert.alert('失败', e?.message); }
  };

  return (
    <Screen>
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 60 }}>
        <Text className="text-[28px] font-bold text-foreground mb-1">设置</Text>
        <Text className="text-[13px] text-muted mb-5">回复小助手 · 训练轮的设定</Text>

        {/* 成长模式 */}
        <Text className="text-[15px] font-semibold text-foreground mb-2">成长模式</Text>
        <Text className="text-[12px] text-muted mb-3">从代写到点评，逐步放手——直到你不再需要它</Text>
        {MODES.map((m) => (
          <TouchableOpacity key={m.key} onPress={() => changeMode(m.key)} disabled={loading}
            className={`rounded-3xl p-4 mb-3 border ${growthMode === m.key ? 'border-accent' : 'border-border'} bg-surface`}>
            <View className="flex-row items-center justify-between">
              <Text className="text-[15px] font-semibold text-foreground">{m.title}</Text>
              <View className={`w-5 h-5 rounded-full border-2 ${growthMode === m.key ? 'bg-accent border-accent' : 'border-muted'}`}>
                {growthMode === m.key && <View className="flex-1 m-[3px] rounded-full bg-white" />}
              </View>
            </View>
            <Text className="text-[13px] text-muted mt-1">{m.desc}</Text>
          </TouchableOpacity>
        ))}

        {/* 节制提醒 */}
        <Text className="text-[15px] font-semibold text-foreground mt-6 mb-2">克制</Text>
        <TouchableOpacity onPress={() => toggleModeration(!moderation)} className="bg-surface rounded-3xl p-4 mb-3 border border-border flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-[15px] font-semibold text-foreground">节制提醒</Text>
            <Text className="text-[12px] text-muted mt-1">开启后，同一人物 24 小时内第 3 次分析将触发劝停「先去做别的事吧」，帮你克制反复追问</Text>
          </View>
          <View className={`w-12 h-7 rounded-full justify-center px-1 ${moderation ? 'bg-accent' : 'bg-[#E5E0DA]'}`}>
            <View className={`w-5 h-5 rounded-full bg-white shadow ${moderation ? 'self-end' : 'self-start'}`} />
          </View>
        </TouchableOpacity>

        {/* AI 接入（自带钥匙） */}
        <Text className="text-[15px] font-semibold text-foreground mt-6 mb-2">AI 接入</Text>
        <View className="bg-surface rounded-3xl p-4 mb-3 border border-border">
          <Text className="text-[14px] font-semibold text-foreground">DeepSeek API Key</Text>
          <Text className="text-[12px] text-muted mt-1 leading-5">
            选填：填写后分析由 App 直连 api.deepseek.com 完成，摆脱对内置服务的依赖（APK 更稳定）。密钥仅保存在本机，不会上传。
          </Text>

          {dsKey && !keyEditing ? (
            <View className="mt-3 flex-row items-center justify-between bg-on-surface rounded-xl px-4 py-3">
              <View className="flex-1 pr-2">
                <Text className="text-[13px] text-muted">已配置</Text>
                <Text className="text-[13px] text-foreground mt-0.5">{maskKey(dsKey)}</Text>
              </View>
              <View className="flex-row gap-2">
                <TouchableOpacity onPress={() => { setKeyInput(dsKey); setKeyEditing(true); }} className="px-4 h-9 bg-accent-soft rounded-full items-center justify-center">
                  <Text className="text-[13px] text-accent font-medium">更新</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setKeyInput(''); setKeyEditing(true); }} className="px-4 h-9 bg-on-surface rounded-full items-center justify-center">
                  <Text className="text-[13px] text-muted">清除</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View className="mt-3">
              <View className="flex-row items-center bg-on-surface rounded-xl px-3">
                <TextInput
                  value={keyInput}
                  onChangeText={setKeyInput}
                  placeholder="sk-……"
                  placeholderTextColor="#BBB"
                  secureTextEntry={!keyVisible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  selectionColorClassName="accent-500"
                  className="flex-1 py-3 text-[13px] text-foreground"
                />
                <TouchableOpacity onPress={() => setKeyVisible(!keyVisible)} className="px-2">
                  <Text className="text-[12px] text-muted">{keyVisible ? '隐藏' : '显示'}</Text>
                </TouchableOpacity>
              </View>
              <View className="flex-row gap-2 mt-2">
                <TouchableOpacity onPress={saveKey} className="flex-1 h-9 bg-accent rounded-full items-center justify-center">
                  <Text className="text-white text-[13px] font-medium">{dsKey ? '保存' : '保存'}</Text>
                </TouchableOpacity>
                {keyEditing && (
                  <TouchableOpacity onPress={() => { setKeyEditing(false); setKeyInput(''); if (!dsKey) { setDsKeyState(''); } }} className="px-4 h-9 bg-on-surface rounded-full items-center justify-center">
                    <Text className="text-[13px] text-muted">取消</Text>
                  </TouchableOpacity>
                )}
              </View>
              {!dsKey && !keyEditing && (
                <Text className="text-[11px] text-accent mt-2">首次使用建议在此填写密钥，避免内置服务连不上时无法分析。</Text>
              )}
            </View>
          )}
        </View>

        {/* 外观 */}
        <Text className="text-[15px] font-semibold text-foreground mt-2 mb-2">外观</Text>
        <View className="bg-surface rounded-2xl p-4 mb-3 border border-border">
          <Text className="text-[12px] text-muted mb-3">深色模式会让你晚上用起来更舒服</Text>
          <View className="flex-row bg-on-surface rounded-full p-0.5">
            {APPEARANCES.map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => setThemeMode(m)}
                className={`flex-1 h-9 rounded-full items-center justify-center ${themeMode === m ? 'bg-accent' : ''}`}
              >
                <Text className={`text-[13px] ${themeMode === m ? 'text-white font-semibold' : 'text-foreground/60'}`}>
                  {APPEARANCE_LABEL[m]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 数据备份 */}
        <Text className="text-[15px] font-semibold text-foreground mt-2 mb-2">数据备份</Text>
        <TouchableOpacity
          onPress={exportData}
          disabled={exporting}
          className="bg-surface rounded-2xl p-4 mb-3 border border-border flex-row items-center justify-between"
        >
          <View className="flex-1 mr-3">
            <Text className="text-[14px] text-foreground">导出全部数据（JSON）</Text>
            <Text className="text-[11px] text-muted mt-0.5">人物档案 + 分析记录 + 周报，建议定期备份</Text>
          </View>
          {exporting ? <ActivityIndicator size="small" color="#E4572E" /> : <Text className="text-muted">›</Text>}
        </TouchableOpacity>

        {/* 安全（可选锁） */}
        <Text className="text-[15px] font-semibold text-foreground mt-2 mb-2">安全</Text>
        <Text className="text-[12px] text-muted mb-3">PIN 锁可选。未设置时打开即用，本机数据不上传</Text>
        <TouchableOpacity onPress={() => setShowPin(true)} className="bg-surface rounded-2xl p-4 mb-3 border border-border flex-row items-center justify-between">
          <Text className="text-[14px] text-foreground">{hasPin ? '修改 PIN 锁' : '设置 PIN 锁（可选）'}</Text>
          <Text className="text-muted">›</Text>
        </TouchableOpacity>
        {hasPin ? (
          <>
            <TouchableOpacity onPress={() => { Alert.alert('关闭 PIN 锁？', '关闭后打开应用无需再输入密码', [{ text: '取消', style: 'cancel' }, { text: '关闭', style: 'destructive', onPress: async () => { try { await disableLock(); Alert.alert('已关闭', '今后打开应用不再需要密码'); } catch (e: any) { Alert.alert('失败', e?.message); } } }]); }}
              className="bg-surface rounded-2xl p-4 mb-3 border border-border flex-row items-center justify-between">
              <Text className="text-[14px] text-danger">关闭 PIN 锁</Text>
              <Text className="text-muted">›</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { Alert.alert('确认锁定？', '锁定后需要输入 PIN 才能继续使用', [{ text: '取消', style: 'cancel' }, { text: '锁定', onPress: () => lock() }]); }}
              className="bg-surface rounded-2xl p-4 border border-border flex-row items-center justify-between">
              <Text className="text-[14px] text-danger">立即锁定</Text>
              <Text className="text-muted">›</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {/* 隐私说明 */}
        <View className="mt-8 py-4 border-t border-separator">
          <Text className="text-center text-[11px] text-muted leading-5 px-4">
            「关于教练式陪伴」：AI 的判断仅供参考，真实的关系由真实的人维护。
            {'\n'}
            聊天记录涉及他人隐私，请勿分享本应用数据。
          </Text>
        </View>
      </ScrollView>

      {/* PIN 修改 Modal */}
      <Modal visible={showPin} transparent animationType="fade" onRequestClose={() => setShowPin(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 28 }} onPress={() => setShowPin(false)}>
          <Pressable className="bg-surface rounded-3xl p-6" onPress={() => undefined}>
            <Text className="text-lg font-semibold text-foreground mb-1">{hasPin ? '设置新 PIN' : '设置 PIN 锁（可选）'}</Text>
            <Text className="text-[13px] text-muted mb-4">4 位数字</Text>
            <TextInput
              value={pinInput} onChangeText={setPinInput} keyboardType="number-pad" maxLength={4} placeholder="••••"
              placeholderTextColor="#BBB" secureTextEntry
              selectionColorClassName="accent-500"
              className="bg-on-surface rounded-xl px-4 py-3 text-lg tracking-[12px] text-center text-foreground mb-4"
            />
            <View className="flex-row gap-3">
              <TouchableOpacity onPress={() => setShowPin(false)} className="flex-1 bg-on-surface rounded-xl py-3.5 items-center">
                <Text className="text-muted">取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={savePin} className="flex-1 bg-foreground rounded-xl py-3.5 items-center">
                <Text className="text-surface font-semibold">保存</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}