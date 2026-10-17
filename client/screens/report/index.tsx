import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/components/Screen';
import { api } from '@/utils/api';
import { downloadDocx } from '@/utils/api';

interface ReportItem {
  id: string;
  content: {
    summary?: string;
    key_events?: string[];
    habits?: string[];
    otherTrend?: string;
    improvements?: string[];
    progress?: string[];
    trends?: string[];
    suggestions?: string[];
  };
  created_at: string;
}

/**
 * 沟通周报页：自动/手动触发，汇总本周全部分析
 */
export default function ReportScreen() {
  const [list, setList] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.reports();
      setList(data || []);
    } catch { /* ignore */ }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const rpt = await api.generateReport();
      if (Platform.OS === 'web' && typeof Notification !== 'undefined') {
        try {
          if (Notification.permission === 'granted') new Notification('Echo Mentor', { body: '本周沟通周报已生成 ✅' });
          else if (Notification.permission === 'default') { /* 不主动请求权限，避免打扰 */ }
        } catch { /* ignore */ }
      }
      Alert.alert('周报已生成');
      await load();
    } catch (e: any) {
      Alert.alert('生成失败', e?.message || '请稍后再试');
    } finally {
      setGenerating(false);
    }
  };

  const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const exportPdf = () => {
    const latest = list[0];
    if (!latest) { Alert.alert('提示', '先生成一份周报'); return; }
    const c = latest.content || {};
    const ul = (arr?: string[]) => `<ul>${(arr || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    const html = `<html><head><meta charset="utf-8"><title>沟通周报</title><style>
      body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;padding:44px;color:#1d1d1f;max-width:640px;margin:0 auto}
      h1{font-size:22px;margin-bottom:4px} h2{font-size:15px;border-left:4px solid #E4572E;padding-left:9px;margin:22px 0 8px}
      li{margin:6px 0;line-height:1.65;font-size:14px} p{font-size:14px;line-height:1.7}
      .meta{color:#86868b;font-size:12px} .card{background:#f5f5f7;border-radius:12px;padding:14px 18px}
    </style></head><body>
      <h1>沟通周报 · ${esc(fmt(latest.created_at))}</h1>
      <p class="meta">由 Echo Mentor 生成</p>
      <h2>本周概况</h2><div class="card"><p>${esc(c.summary || '')}</p></div>
      ${c.key_events?.length ? `<h2>本周关键事件</h2>${ul(c.key_events)}` : ''}
      <h2>聊天习惯模式</h2>${ul(c.habits)}
      <h2>对方回应趋势</h2><p>${esc(c.otherTrend || '')}</p>
      <h2>改进建议</h2>${ul(c.improvements)}
      <h2>进步点</h2>${ul(c.progress)}
    </body></html>`;
    if (Platform.OS !== 'web') { Alert.alert('提示', 'PDF 导出请在网页版使用'); return; }
    const w = window.open('', '_blank');
    if (!w) { Alert.alert('提示', '浏览器拦截了新窗口，请允许弹出窗口后重试'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const fmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <Screen>
      <ScrollView
        className="flex-1 bg-[#FAFAFA] dark:bg-gray-900"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Text className="text-[28px] font-bold text-gray-900 dark:text-white mb-1">沟通周报</Text>
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-[13px] text-gray-500 dark:text-gray-400 flex-1 mr-3">每周日自动汇总，也可随时手动生成</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity onPress={exportPdf} className="px-4 h-9 rounded-full bg-surface border border-border items-center justify-center">
              <Text className="text-[13px] font-medium text-foreground">📄 导出 PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={async () => {
                const latest = list[0];
                if (!latest) { Alert.alert('提示', '先生成一份周报'); return; }
                try { await downloadDocx(`/api/v1/reports/${latest.id}/docx`, `沟通周报-${fmt(latest.created_at)}.docx`); Alert.alert('已导出', 'Word 文档已下载'); }
                catch (e: any) { Alert.alert('导出失败', e?.message); }
              }}
              className="px-4 h-9 rounded-full bg-accent items-center justify-center"
            >
              <Text className="text-[13px] font-semibold text-white">📝 导出 Word</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          onPress={handleGenerate}
          disabled={generating}
          className="bg-accent rounded-2xl py-4 items-center mb-6 active:opacity-80"
        >
          {generating ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold text-[15px]">生成 / 刷新本周周报</Text>}
        </TouchableOpacity>

        {loading && <ActivityIndicator className="mt-4" />}

        {!list.length && !loading ? (
          <View className="py-16 items-center">
            <Text className="text-gray-400 dark:text-gray-500">还没有周报</Text>
            <Text className="text-gray-300 dark:text-gray-600 text-[13px] mt-1">先去做一些沟通分析吧</Text>
          </View>
        ) : (
          list.map((r) => (
            <View key={r.id} className="bg-surface rounded-3xl p-5 mb-4 shadow-sm border border-border">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-[15px] font-semibold text-gray-900 dark:text-white">{fmt(r.created_at)} 周报</Text>
                <Text className="text-[11px] text-gray-400">自动周报</Text>
              </View>
              {!!r.content?.summary && (
                <Text className="text-[13px] leading-5 text-gray-700 dark:text-gray-300 mb-3">{r.content.summary}</Text>
              )}
              {!!r.content?.key_events?.length && (
                <Section title="本周关键事件" items={r.content.key_events} icon="★" />
              )}
              {!!r.content?.habits?.length && <Section title="聊天习惯模式" items={r.content.habits} icon="·" />}
              {!!r.content?.otherTrend && (
                <View className="mb-3">
                  <Text className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 mb-1">对方回应趋势</Text>
                  <Text className="text-[13px] leading-5 text-gray-700 dark:text-gray-300">{r.content.otherTrend}</Text>
                </View>
              )}
              {!!r.content?.trends?.length && <Section title="对方回应趋势" items={r.content.trends} icon="·" />}
              {!!r.content?.improvements?.length && <Section title="改进建议" items={r.content.improvements} icon="·" />}
              {!!r.content?.suggestions?.length && <Section title="改进建议" items={r.content.suggestions} icon="·" />}
              {!!r.content?.progress?.length && <Section title="进步点" items={r.content.progress} icon="✓" />}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function Section({ title, items, icon }: { title: string; items?: string[]; icon: string }) {
  if (!items || !items.length) return null;
  return (
    <View className="mb-3">
      <Text className="text-[12px] font-medium text-gray-400 mb-1.5">{title}</Text>
      {items.map((it, i) => (
        <View key={i} className="flex-row mb-1">
          <Text className="text-gray-300 dark:text-gray-500 mr-2">{icon}</Text>
          <Text className="text-[14px] text-gray-700 dark:text-gray-200 flex-1 leading-5">{it}</Text>
        </View>
      ))}
    </View>
  );
}