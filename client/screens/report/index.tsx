import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '@/components/Screen';
import { api } from '@/utils/api';

interface ReportItem {
  id: string;
  content: { habits: string[]; trends: string[]; suggestions: string[]; progress: string[] };
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
      Alert.alert('周报已生成');
      await load();
    } catch (e: any) {
      Alert.alert('生成失败', e?.message || '请稍后再试');
    } finally {
      setGenerating(false);
    }
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
        <Text className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">每周日自动汇总，也可随时手动生成</Text>

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
            <View key={r.id} className="bg-white dark:bg-gray-800 rounded-3xl p-5 mb-4 shadow-sm border border-gray-100 dark:border-gray-700">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-[15px] font-semibold text-gray-900 dark:text-white">{fmt(r.created_at)} 周报</Text>
                <Text className="text-[11px] text-gray-400">自动周报</Text>
              </View>
              <Section title="聊天习惯模式" items={r.content?.habits} icon="·" />
              <Section title="对方回应趋势" items={r.content?.trends} icon="·" />
              <Section title="改进建议" items={r.content?.suggestions} icon="·" />
              <Section title="进步点" items={r.content?.progress} icon="✓" />
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