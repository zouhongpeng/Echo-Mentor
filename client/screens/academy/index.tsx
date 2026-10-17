import { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Screen } from "@/components/Screen";
import { METHOD_CARDS, REPLY_PHRASES, INTENT_PHRASES, ACADEMY_FOOTER, type MethodCard } from "@/constants/methodologies";

const CARD_GRADIENTS: [string, string][] = [
  ["#FFD9CE", "#FFEFE9"], // 非暴力沟通 - 珊瑚暖
  ["#D4E1F2", "#EDF2FA"], // 关键对话 - 雾蓝
  ["#F3E3D8", "#FBF3EC"], // 课题分离 - 暖米
  ["#E7DFEF", "#FAF5FC"], // 表达频道 - 雾紫
  ["#D9EDE4", "#EFF9F4"], // 知觉检核 - 薄荷绿
  ["#F2E6D0", "#FBF4E7"], // 校准问题 - 杏仁暖
  ["#DCDFF2", "#F0F1FC"], // 情绪标注 - 长春花紫
  ["#F6DCDC", "#FDEFEE"], // 仁慈归因 - 樱花粉
];

function MethodPage({ card, index }: { card: MethodCard; index: number }) {
  const [from, to] = CARD_GRADIENTS[index % CARD_GRADIENTS.length];
  return (
    <View className="w-full px-4 py-2">
      <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} className="rounded-[28px] p-6">
        <Text className="text-[11px] font-medium text-foreground/50">沟通方法论 · 卡{index + 1}</Text>
        <Text className="mt-1 text-[26px] font-bold text-foreground">{card.title}</Text>
        <Text className="mt-1 text-[12px] text-foreground/60">来源：{card.source}</Text>

        <View className="mt-4 rounded-2xl bg-surface/80 p-4">
          <Text className="text-[12px] font-semibold text-accent">适用场景</Text>
          <Text className="mt-1 text-[13px] leading-5 text-foreground">{card.scene}</Text>
        </View>

        <Text className="mt-5 text-[13px] font-semibold text-foreground">核心原则</Text>
        <View className="mt-2 space-y-3">
          {card.core.map((line, i) => (
            <View key={i} className="flex-row gap-2.5">
              <View className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
              <Text className="flex-1 text-[13px] leading-[21px] text-foreground/85">{line}</Text>
            </View>
          ))}
        </View>

        <View className="mt-5 rounded-2xl border border-border bg-surface/70 p-4">
          <Text className="text-[12px] font-semibold text-foreground">使用要点</Text>
          <Text className="mt-1 text-[12.5px] leading-5 text-foreground/75">{card.usage}</Text>
          <View className="mt-3 h-px bg-border" />
          <Text className="mt-3 text-[12px] font-semibold text-foreground">禁用提醒</Text>
          <Text className="mt-1 text-[12.5px] leading-5 text-foreground/75">{card.forbid}</Text>
        </View>

        <View className="mt-5 rounded-2xl bg-foreground px-4 py-3">
          <Text className="text-[13px] leading-5 text-surface">小结 · {card.summary}</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

export default function AcademyScreen() {
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<"method" | "phrase">("method");
  const { width } = useWindowDimensions();
  const itemWidth = width;

  return (
    <Screen>
      <View className="px-5 pb-2 pt-1">
        <Text className="text-[22px] font-bold text-foreground">沟通学院</Text>
        <Text className="mt-1 text-[12.5px] text-foreground/55">{METHOD_CARDS.length} 套方法论 + 高频回复话术，边看边用</Text>
      </View>

      {/* 顶栏：方法论 / 话术速查 */}
      <View className="px-5 pb-3">
        <View className="flex-row bg-[#EFEFEF] rounded-full p-0.5 self-start">
          {([["method", "方法论"], ["phrase", "话术速查"]] as const).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              onPress={() => setTab(key)}
              className={`px-4 h-8 rounded-full items-center justify-center ${tab === key ? "bg-white shadow-sm" : ""}`}
            >
              <Text className={`text-[12.5px] ${tab === key ? "text-foreground font-semibold" : "text-foreground/60"}`}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === "method" ? (
        <>
          <View className="px-5 pb-3">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {METHOD_CARDS.map((c, i) => (
                <TouchableOpacity
                  key={c.id}
                  activeOpacity={0.7}
                  onPress={() => setActive(i)}
                  className={`rounded-full px-4 py-2 ${i === active ? "bg-accent" : "bg-surface"}`}
                >
                  <Text className={`text-[12.5px] font-medium ${i === active ? "text-white" : "text-foreground/70"}`}>
                    {c.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={{ flex: 1 }}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setActive(Math.round(e.nativeEvent.contentOffset.x / (itemWidth || width)))}
            >
              {METHOD_CARDS.map((card, i) => (
                <View key={card.id} style={{ width: itemWidth }}>
                  <MethodPage card={card} index={i} />
                </View>
              ))}
            </ScrollView>
          </View>
        </>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
          <Text className="px-1 pb-2 text-[12px] leading-5 text-foreground/50">
            以下句式供直接参考。AI 分析时也会按场景与风格参考这些话术，再结合你的对话改写。
          </Text>
          {Object.entries(REPLY_PHRASES).map(([scene, styles]) => (
            <View key={scene} className="mb-4">
              <Text className="px-1 mb-2 text-[14px] font-semibold text-foreground">{scene}</Text>
              {Object.entries(styles).map(([style, phrases]) => (
                <View key={style} className="bg-white rounded-2xl border border-[#E5E5EA] px-4 py-3 mb-2">
                  <Text className="text-[12px] font-semibold text-accent mb-1">{style}</Text>
                  {phrases.map((p, i) => (
                    <Text key={i} className="text-[13px] leading-5 text-foreground/85 mb-1">· {p}</Text>
                  ))}
                </View>
              ))}
            </View>
          ))}
          <Text className="px-1 pt-1 pb-2 text-[14px] font-semibold text-foreground">高频意图 · 跨场景</Text>
          {Object.entries(INTENT_PHRASES).map(([intent, v]) => (
            <View key={intent} className="bg-white rounded-2xl border border-[#E5E5EA] px-4 py-3 mb-2">
              <Text className="text-[13px] font-semibold text-foreground">{intent}</Text>
              <Text className="mt-0.5 text-[11px] leading-4 text-foreground/55">{v.tip}</Text>
              {v.phrases.map((p, i) => (
                <Text key={i} className="mt-1.5 text-[13px] leading-5 text-foreground/85">· {p}</Text>
              ))}
            </View>
          ))}
          <View className="pb-6 pt-4">
            <Text className="text-center text-[10.5px] leading-4 text-foreground/40">{ACADEMY_FOOTER}</Text>
          </View>
        </ScrollView>
      )}

      {tab === "method" && (
        <View className="pb-6 pt-5">
          <Text className="px-8 text-center text-[10.5px] leading-4 text-foreground/40">{ACADEMY_FOOTER}</Text>
        </View>
      )}
    </Screen>
  );
}