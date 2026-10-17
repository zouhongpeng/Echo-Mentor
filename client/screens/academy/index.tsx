import { useState, useEffect, useRef } from "react";
import { View, Text, ScrollView, TouchableOpacity, useWindowDimensions } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { Screen } from "@/components/Screen";
import { METHOD_CARDS, REPLY_PHRASES, INTENT_PHRASES, ACADEMY_FOOTER, type MethodCard } from "@/constants/methodologies";
import { useTheme } from "@/contexts/ThemeContext";

/* 浅色：柔和粉彩；深色：低饱和深色调（同色相，保证深色模式可读） */
const CARD_GRADIENTS_LIGHT: [string, string][] = [
  ["#FFD9CE", "#FFEFE9"], // 非暴力沟通 - 珊瑚暖
  ["#D4E1F2", "#EDF2FA"], // 关键对话 - 雾蓝
  ["#F3E3D8", "#FBF3EC"], // 课题分离 - 暖米
  ["#E7DFEF", "#FAF5FC"], // 表达频道 - 雾紫
  ["#D9EDE4", "#EFF9F4"], // 知觉检核 - 薄荷绿
  ["#F2E6D0", "#FBF4E7"], // 校准问题 - 杏仁暖
  ["#DCDFF2", "#F0F1FC"], // 情绪标注 - 长春花紫
  ["#F6DCDC", "#FDEFEE"], // 仁慈归因 - 樱花粉
];
const CARD_GRADIENTS_DARK: [string, string][] = [
  ["#3A2A2B", "#221A20"], // 非暴力沟通 - 暗珊瑚
  ["#22304A", "#161C2C"], // 关键对话 - 深海蓝
  ["#3A3222", "#241F15"], // 课题分离 - 暗金
  ["#33284A", "#1F1929"], // 表达频道 - 暗紫
  ["#1F3629", "#142019"], // 知觉检核 - 暗薄荷
  ["#3A3020", "#241E12"], // 校准问题 - 暗杏仁
  ["#2B2845", "#1A1826"], // 情绪标注 - 暗长春花
  ["#452323", "#291614"], // 仁慈归因 - 暗樱红
];

function MethodPage({ card, index }: { card: MethodCard; index: number }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [from, to] = (dark ? CARD_GRADIENTS_DARK : CARD_GRADIENTS_LIGHT)[index % (dark ? CARD_GRADIENTS_DARK : CARD_GRADIENTS_LIGHT).length];
  return (
    <View className="w-full px-4 py-3">
      <LinearGradient
        colors={[from, to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="rounded-[28px] p-6"
        style={{
          shadowColor: dark ? "#000" : "#E4572E",
          shadowOpacity: dark ? 0.5 : 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 4,
          borderWidth: 1,
          borderColor: dark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.6)",
        }}
      >
        <Text className={`text-[11px] font-medium tracking-wider ${dark ? "text-white/45" : "text-foreground/50"}`}>沟通方法论 · 卡{index + 1}</Text>
        <Text className="mt-1 text-[26px] font-bold text-foreground">{card.title}</Text>
        <Text className={`mt-1 text-[12px] ${dark ? "text-white/55" : "text-foreground/60"}`}>来源：{card.source}</Text>

        <View className={`mt-4 rounded-2xl p-4 ${dark ? "bg-white/5" : "bg-surface/80"}`}>
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

        <View className={`mt-5 rounded-2xl border p-4 ${dark ? "border-white/8 bg-white/5" : "border-border bg-surface/70"}`}>
          <Text className="text-[12px] font-semibold text-foreground">使用要点</Text>
          <Text className="mt-1 text-[12.5px] leading-5 text-foreground/75">{card.usage}</Text>
          <View className="mt-3 h-px bg-border" />
          <Text className="mt-3 text-[12px] font-semibold text-foreground">禁用提醒</Text>
          <Text className="mt-1 text-[12.5px] leading-5 text-foreground/75">{card.forbid}</Text>
        </View>

        <View className={`mt-5 rounded-2xl px-4 py-3 ${dark ? "bg-white/10" : "bg-foreground"}`}>
          <Text className={`text-[13px] leading-5 ${dark ? "text-white/90" : "text-surface"}`}>小结 · {card.summary}</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

export default function AcademyScreen() {
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<"method" | "phrase">("method");
  const [favs, setFavs] = useState<string[]>([]);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const pagingRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    AsyncStorage.getItem("echo_mentor_fav_phrases").then((v) => {
      try { setFavs(JSON.parse(v || "[]")); } catch { /* ignore */ }
    });
  }, [tab]);

  const toggleFav = async (phrase: string) => {
    const next = favs.includes(phrase) ? favs.filter((x) => x !== phrase) : [...favs, phrase];
    setFavs(next);
    try { await AsyncStorage.setItem("echo_mentor_fav_phrases", JSON.stringify(next)); } catch { /* ignore */ }
  };
  const { width } = useWindowDimensions();
  const itemWidth = width;

  return (
    <Screen>
      <View className="px-5 pb-3 pt-2">
        <Text className="text-[28px] font-bold text-foreground tracking-tight">沟通学院</Text>
        <Text className="mt-1 text-[12.5px] text-foreground/55">{METHOD_CARDS.length} 套方法论 + 高频回复话术，边看边用</Text>
      </View>

      {/* 顶栏：方法论 / 话术速查 */}
      <View className="px-5 pb-3">
        <View className="flex-row bg-on-surface rounded-full p-0.5 self-start">
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
                  className={`rounded-full px-4 h-9 items-center justify-center ${i === active ? "bg-accent" : "bg-surface border border-border"}`}
                >
                  <Text className={`text-[13.5px] font-medium ${i === active ? "text-white" : "text-foreground/70"}`}>
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
            以下句式供直接参考（点 ☆ 收藏常用句，AI 会优先化用你的收藏）。
          </Text>
          {favs.length > 0 && (
            <View className="rounded-2xl px-4 py-3 mb-4 border border-accent/30" style={{ backgroundColor: dark ? "rgba(91,192,222,0.10)" : "rgba(91,192,222,0.08)" }}>
              <Text className="text-[12px] font-semibold text-accent mb-1">我的收藏（{favs.length}）</Text>
              {favs.map((p, i) => (
                <View key={i} className="flex-row items-start mb-1">
                  <Text className="flex-1 text-[13px] leading-5 text-foreground/85">· {p}</Text>
                  <TouchableOpacity onPress={() => toggleFav(p)} hitSlop={8} className="ml-2">
                    <Text className="text-[11px] text-muted">移除</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          {Object.entries(REPLY_PHRASES).map(([scene, styles]) => (
            <View key={scene} className="mb-4">
              <Text className="px-1 mb-2 text-[14px] font-semibold text-foreground">{scene}</Text>
              {Object.entries(styles).map(([style, phrases]) => (
                <View key={style} className="rounded-2xl border border-border px-4 py-3 mb-2" style={{ backgroundColor: dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.85)" }}>
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
            <View key={intent} className="rounded-2xl border border-border px-4 py-3 mb-2" style={{ backgroundColor: dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.85)" }}>
              <Text className="text-[13px] font-semibold text-foreground">{intent}</Text>
              <Text className="mt-0.5 text-[11px] leading-4 text-foreground/55">{v.tip}</Text>
              {v.phrases.map((p, i) => (
                <View key={i} className="flex-row items-start mt-1.5">
                  <Text className="flex-1 text-[13px] leading-5 text-foreground/85">· {p}</Text>
                  <TouchableOpacity onPress={() => toggleFav(p)} hitSlop={8} className="ml-2">
                    <Text className="text-[13px]">{favs.includes(p) ? "★" : "☆"}</Text>
                  </TouchableOpacity>
                </View>
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