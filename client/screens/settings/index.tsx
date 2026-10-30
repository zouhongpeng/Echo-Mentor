import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Modal, TextInput, Platform, Animated,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { api, downloadDocx } from '@/utils/api';
import { useTheme } from '@/contexts/ThemeContext';
import JellySwitch from '@/components/JellySwitch';
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

  // DeepSeek 「自带钥匙」状态
  const [dsKey, setDsKeyState] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);

  // 视觉模型（截图识别）状态
  const [visionInfo, setVisionInfo] = useState<{ configured: boolean; source: string; model: string; key_masked: string } | null>(null);
  const [visionKeyInput, setVisionKeyInput] = useState('');
  const [visionUrlInput, setVisionUrlInput] = useState('');
  const [visionModelInput, setVisionModelInput] = useState('');
  const [visionSaving, setVisionSaving] = useState(false);
  const loadVision = useCallback(async () => {
    // 优先展示本机直连配置（App 直连智谱，不依赖服务器）
    const { getLocalVision } = await import('@/utils/vision');
    const local = await getLocalVision();
    if (local) {
      setVisionInfo({ configured: true, source: '本机直连', model: local.model, key_masked: maskKey(local.apiKey) });
      setVisionUrlInput((s) => s || '');
      setVisionModelInput((s) => s || '');
      return;
    }
    try {
      const v = await api.visionSettings();
      setVisionInfo(v);
      setVisionUrlInput((s) => s || v.base_url || '');
      setVisionModelInput((s) => s || v.model || '');
    } catch { /* 静默 */ }
  }, []);
  React.useEffect(() => { loadVision(); }, [loadVision]);
  const saveVision = async () => {
    if (!visionKeyInput.trim() || visionSaving) return;
    setVisionSaving(true);
    try {
      // 先存本机（App 直连智谱，服务器不可达也能用）
      const { saveLocalVision } = await import('@/utils/vision');
      await saveLocalVision(visionKeyInput.trim(), visionUrlInput.trim() || undefined, visionModelInput.trim() || undefined);
      // 再尝试同步到服务器（失败不影响）
      await api.saveVisionKey(visionKeyInput.trim(), visionUrlInput.trim() || undefined, visionModelInput.trim() || undefined).catch(() => {});
      setVisionKeyInput('');
      await loadVision();
      Alert.alert('已保存', '视觉模型配置已生效（本机直连，不依赖服务器），去「帮我分析 → 截图识别」试试吧。');
    } catch (e: any) {
      Alert.alert('保存失败', e?.message);
    } finally {
      setVisionSaving(false);
    }
  };
  const [keyEditing, setKeyEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  const doImport = async (raw: string) => {
    let payload: any;
    try { payload = JSON.parse(raw); } catch { Alert.alert('失败', '内容不是合法的 JSON，请粘贴导出的备份内容'); return; }
    if (!payload || (!payload.people?.length && !payload.analyses?.length && !payload.reports?.length)) {
      Alert.alert('失败', '备份内容为空或格式不对（应包含 people / analyses / reports）');
      return;
    }
    setImporting(true);
    try {
      const r = await api.importData(payload);
      setImportModal(false);
      setImportText('');
      Alert.alert('导入完成', `人物 ${r.people} · 日期 ${r.dates} · 分析记录 ${r.analyses} · 周报 ${r.reports}`);
    } catch (e: any) {
      Alert.alert('导入失败', e?.message);
    } finally {
      setImporting(false);
    }
  };

  const pickBackupFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const fr = new FileReader();
      fr.onload = () => doImport(String(fr.result));
      fr.readAsText(file);
    };
    input.click();
  };
  const { themeMode, setThemeMode } = useTheme();

  // 开关联动「震动」：选中一项时，其他选项做视觉抖动（不改变状态）
  const jiggle = React.useRef<Record<string, Animated.Value>>({}).current;
  const getJiggle = (k: string) => (jiggle[k] = jiggle[k] || new Animated.Value(0));
  const triggerJiggle = (excludeKeys: string[]) => {
    Object.keys(jiggle).forEach((k) => {
      if (excludeKeys.includes(k)) return;
      Animated.sequence([
        Animated.timing(getJiggle(k), { toValue: 1, duration: 55, useNativeDriver: true }),
        Animated.timing(getJiggle(k), { toValue: -1, duration: 55, useNativeDriver: true }),
        Animated.timing(getJiggle(k), { toValue: 0.6, duration: 45, useNativeDriver: true }),
        Animated.timing(getJiggle(k), { toValue: 0, duration: 45, useNativeDriver: true }),
      ]).start();
    });
  };
  React.useEffect(() => { triggerJiggle(['__init__']); }, []);
  React.useEffect(() => { triggerJiggle([growthMode, ...APPEARANCES.filter((m) => m === themeMode)]); }, [growthMode, themeMode]);

  // 导出全部数据：人物 + 各人物分析记录 + 周报（Web 端下载 JSON，原生端走系统分享）
  const exportData = async () => {
    setExporting(true);
    try {
      const people = (await api.people()) || [];
      const analyses: any[] = [];
      const fullPeople: any[] = [];
      for (const p of people) {
        try {
          const full = await api.person(p.id); // 含重要日期
          fullPeople.push({ ...full });
          const list = await api.personAnalyses(p.id);
          for (const a of list || []) analyses.push({ ...a, person_name: p.name });
        } catch { /* 单人失败不影响整体 */ }
      }
      let reports: any[] = [];
      try { reports = (await api.reports()) || []; } catch { /* ignore */ }
      const payload = {
        exported_at: new Date().toISOString(),
        version: 1,
        people: fullPeople.length ? fullPeople : people,
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
        // 原生端：写文件 → 系统分享（可存到文件管理器/发给自己）
        const { shareTextFile } = await import('@/utils/api');
        await shareTextFile(json, filename);
        Alert.alert('已导出', `${filename} 已通过系统分享发出（${people.length} 位人物、${analyses.length} 条分析记录）。`);
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

  return (
    <Screen>
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 60 }}>
        <Text className="text-[28px] font-bold text-foreground mb-1">设置</Text>
        <Text className="text-[13px] text-muted mb-5">回复小助手 · 训练轮的设定</Text>

        {/* 成长模式 */}
        <Text className="text-[15px] font-semibold text-foreground mb-2">成长模式</Text>
        <Text className="text-[12px] text-muted mb-3">从代写到点评，逐步放手——直到你不再需要它</Text>
        {MODES.map((m) => (
          <TouchableOpacity onPress={() => { changeMode(m.key); triggerJiggle([`mode:${m.key}`]); }} disabled={loading}
            className={`rounded-3xl p-4 mb-3 border ${growthMode === m.key ? 'border-accent' : 'border-border'} bg-surface`}>
            <View className="flex-row items-center justify-between">
              <Text className="text-[15px] font-semibold text-foreground">{m.title}</Text>
              <Animated.View
                style={{ transform: [{ rotate: getJiggle(`mode:${m.key}`).interpolate({ inputRange: [-1, 1], outputRange: ['-14deg', '14deg'] }) }] }}
              >
                <View className={`w-5 h-5 rounded-full border-2 ${growthMode === m.key ? 'bg-accent border-accent' : 'border-muted'}`}>
                  {growthMode === m.key && <View className="flex-1 m-[3px] rounded-full bg-white" />}
                </View>
              </Animated.View>
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
          <JellySwitch value={moderation} onToggle={(v) => toggleModeration(v)} />
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

        {/* 导入 Modal */}
        <Modal visible={importModal} transparent animationType="slide" onRequestClose={() => setImportModal(false)}>
          <View className="flex-1 bg-black/30 justify-end">
            <View className="bg-surface rounded-t-3xl p-6 pb-8">
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-xl font-bold text-foreground">导入备份</Text>
                <TouchableOpacity onPress={() => setImportModal(false)} hitSlop={10}><Text className="text-2xl text-muted">✕</Text></TouchableOpacity>
              </View>
              <Text className="text-[12px] text-muted mb-3 leading-5">
                粘贴之前导出的 JSON 备份内容，或选择备份文件。导入会按记录 ID 合并（已存在则更新），不会删除现有数据。
              </Text>
              <View className="flex-row gap-2 mb-3">
                {Platform.OS === 'web' && (
                  <TouchableOpacity onPress={pickBackupFile} className="px-4 h-9 rounded-full bg-accent-soft items-center justify-center">
                    <Text className="text-[13px] text-accent font-medium">选择备份文件</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TextInput
                value={importText}
                onChangeText={setImportText}
                placeholder='或在此粘贴 JSON，如 {"exported_at":…,"people":[…]}'
                placeholderTextColor="#9C9CA3"
                multiline
                className="bg-on-surface rounded-xl px-4 py-3 text-[12px] text-foreground min-h-[120px] font-mono"
              />
              <TouchableOpacity onPress={() => doImport(importText)} disabled={importing || !importText.trim()} className="mt-4 h-12 rounded-xl bg-accent items-center justify-center">
                {importing ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold">开始导入</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* 外观 */}
        <Text className="text-[15px] font-semibold text-foreground mt-2 mb-2">外观</Text>
        <View className="bg-surface rounded-2xl p-4 mb-3 border border-border">
          <Text className="text-[12px] text-muted mb-3">深色模式会让你晚上用起来更舒服</Text>
          <View className="flex-row bg-on-surface rounded-full p-0.5">
            {APPEARANCES.map((m) => (
              <TouchableOpacity
                key={m}
                onPress={() => { setThemeMode(m); triggerJiggle([`app:${m}`]); }}
                className={`flex-1 h-10 rounded-full items-center justify-center ${themeMode === m ? 'bg-accent' : ''}`}
              >
                <Animated.Text
                  style={{
                    fontSize: 13.5,
                    fontWeight: themeMode === m ? '600' : '400',
                    color: themeMode === m ? '#fff' : 'rgba(63,58,54,0.6)',
                    transform: [{ translateX: getJiggle(`app:${m}`).interpolate({ inputRange: [-1, 1], outputRange: [-2.5, 2.5] }) }],
                  }}
                >
                  {APPEARANCE_LABEL[m]}
                </Animated.Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 视觉模型（截图识别） */}
        <Text className="text-[15px] font-semibold text-foreground mt-2 mb-2">视觉模型 · 截图识别</Text>
        <View className="bg-surface rounded-2xl p-4 mb-3 border border-border">
          <Text className="text-[12px] text-muted mb-2 leading-4">
            {visionInfo?.configured
              ? `已配置（来源：${visionInfo.source}）· 模型：${visionInfo.model} · Key：${visionInfo.key_masked}`
              : '未配置。推荐粘贴智谱 API Key（open.bigmodel.cn 免费申请，模型 glm-4.6v-flash），保存后立即生效。'}
          </Text>
          <TextInput
            value={visionKeyInput}
            onChangeText={setVisionKeyInput}
            placeholder="粘贴视觉模型 API Key"
            placeholderTextColor="#C9C9C9"
            autoCapitalize="none"
            autoCorrect={false}
            className="bg-on-surface rounded-xl px-3.5 h-11 text-[13px] text-foreground mb-2"
          />
          {/* 高级：接口地址与模型名（换服务商时才需要改，如豆包/硅基流动） */}
          <Text className="text-[11px] text-muted/70 mb-1">换其他服务商时才需要改下面两项（默认智谱）：</Text>
          <TextInput
            value={visionUrlInput}
            onChangeText={setVisionUrlInput}
            placeholder="接口地址（默认智谱，豆包填 ark.cn-beijing.volces.com/api/v3/chat/completions）"
            placeholderTextColor="#C9C9C9"
            autoCapitalize="none"
            autoCorrect={false}
            className="bg-on-surface rounded-xl px-3.5 h-11 text-[12px] text-foreground mb-2"
          />
          <TextInput
            value={visionModelInput}
            onChangeText={setVisionModelInput}
            placeholder="模型名（默认 glm-4.6v-flash，豆包如 doubao-seed-1.6-flash）"
            placeholderTextColor="#C9C9C9"
            autoCapitalize="none"
            autoCorrect={false}
            className="bg-on-surface rounded-xl px-3.5 h-11 text-[12px] text-foreground mb-2"
          />
          <TouchableOpacity
            onPress={saveVision}
            disabled={visionSaving || !visionKeyInput.trim()}
            className="h-10 rounded-xl bg-accent items-center justify-center self-start px-5"
          >
            {visionSaving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text className="text-white text-[13px] font-semibold">保存并生效</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* 数据备份 */}
        <Text className="text-[15px] font-semibold text-foreground mt-2 mb-2">数据备份</Text>
        <TouchableOpacity
          onPress={async () => {
            try {
              await downloadDocx("/api/v1/export/docx", `Echo-Mentor-全部档案-${new Date().toISOString().slice(0, 10)}.docx`);
              Alert.alert("已导出", "全部档案 Word 文档已发出：所有人物、时间线分析和周报都在里面，可直接阅读或打印。");
            } catch (e: any) {
              Alert.alert("导出失败", e?.message);
            }
          }}
          className="bg-accent rounded-2xl p-4 mb-3 flex-row items-center justify-between"
        >
          <View className="flex-1 mr-3">
            <Text className="text-[14px] text-white font-semibold">导出全部档案（Word）</Text>
            <Text className="text-[11px] text-white/70 mt-0.5">人物 + 时间线 + 周报 → 一份可读的 Word 文档</Text>
          </View>
          <Text className="text-white">›</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={exportData}
          disabled={exporting}
          className="bg-surface rounded-2xl p-4 mb-3 border border-border flex-row items-center justify-between"
        >
          <View className="flex-1 mr-3">
            <Text className="text-[14px] text-foreground">导出备份数据（JSON）</Text>
            <Text className="text-[11px] text-muted mt-0.5">换手机恢复用（机器可读格式），日常存档建议用上面的 Word 版</Text>
          </View>
          {exporting ? <ActivityIndicator size="small" color="#E4572E" /> : <Text className="text-muted">›</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setImportModal(true)}
          className="bg-surface rounded-2xl p-4 mb-3 border border-border flex-row items-center justify-between"
        >
          <Text className="text-[14px] text-foreground">导入备份（粘贴 / 选择文件）</Text>
          <Text className="text-muted">›</Text>
        </TouchableOpacity>

        {/* 隐私说明 */}
        <View className="mt-8 py-4 border-t border-separator">
          <Text className="text-center text-[11px] text-muted leading-5 px-4">
            「关于教练式陪伴」：AI 的判断仅供参考，真实的关系由真实的人维护。
            {'\n'}
            聊天记录涉及他人隐私，请勿分享本应用数据。
          </Text>
        </View>
      </ScrollView>

    </Screen>
  );
}