import { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { Screen } from "@/components/Screen";
import { api } from "@/utils/api";
import { METHOD_CARDS, REPLY_PHRASES, INTENT_PHRASES, ACADEMY_FOOTER, type MethodCard } from "@/constants/methodologies";
import { useTheme } from "@/contexts/ThemeContext";

/* 浅色：柔和粉彩；深色：低饱和深色调 */
const CARD_GRADIENTS_LIGHT: [string, string][] = [
  ["#FFD9CE", "#FFEFE9"],
  ["#D4E1F2", "#EDF2FA"],
  ["#F3E3D8", "#FBF3EC"],
  ["#E7DFEF", "#FAF5FC"],
  ["#D9EDE4", "#EFF9F4"],
  ["#F2E6D0", "#FBF4E7"],
  ["#DCDFF2", "#F0F1FC"],
  ["#F6DCDC", "#FDEFEE"],
];
const CARD_GRADIENTS_DARK: [string, string][] = [
  ["#3A2A2B", "#221A20"],
  ["#22304A", "#161C2C"],
  ["#3A3222", "#241F15"],
  ["#33284A", "#1F1929"],
  ["#1F3629", "#142019"],
  ["#3A3020", "#241E12"],
  ["#2B2845", "#1A1826"],
  ["#452323", "#291614"],
];

/* 使用统计：把服务端返回的风格标签聚合到对应方法卡上 */
function useMethodUsage() {
  const [usage, setUsage] = useState<{ counts: Record<string, number>; latest: Record<string, string> }>({ counts: {}, latest: {} });
  const load = useCallback(async () => {
    try {
      const u = await api.academyUsage();
      const counts: Record<string, number> = {};
      const latest: Record<string, string> = {};
      for (const card of METHOD_CARDS) {
        let n = 0;
        let last = "";
        for (const [tag, c] of Object.entries(u.counts || {})) {
          if (tag.includes(card.title) || card.title.includes(tag)) {
            n += c;
            const l = u.latest?.[tag];
            if (l && (!last || l > last)) last = l;
          }
        }
        counts[card.title] = n;
        if (last) latest[card.title] = last;
      }
      setUsage({ counts, latest });
    } catch { /* 静默：统计失败不影响浏览 */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { usage, reload: load };
}

function usageBadge(title: string, usage: { counts: Record<string, number>; latest: Record<string, string> }) {
  const n = usage.counts[title] || 0;
  if (!n) return null;
  const last = usage.latest[title];
  return (
    <View className="px-2 py-0.5 rounded-full bg-accent-soft">
      <Text className="text-[10.5px] text-accent font-medium">
        已用 {n} 次{last ? ` · 最近 ${last.slice(5).replace("-", "/")}` : ""}
      </Text>
    </View>
  );
}

/* 完整方法卡（展开时渲染） */
function MethodPage({ card, index }: { card: MethodCard; index: number }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [from, to] = (dark ? CARD_GRADIENTS_DARK : CARD_GRADIENTS_LIGHT)[index % (dark ? CARD_GRADIENTS_DARK : CARD_GRADIENTS_LIGHT).length];
  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      className="rounded-[24px] p-5 mt-2"
      style={{ elevation: 3, borderWidth: 1, borderColor: dark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.6)" }}
    >
      <Text className={`text-[11px] font-medium tracking-wider ${dark ? "text-white/45" : "text-foreground/50"}`}>沟通方法论 · {card.source}</Text>
      <Text className="mt-1 text-[22px] font-bold text-foreground">{card.title}</Text>

      <View className={`mt-3 rounded-2xl p-3.5 ${dark ? "bg-white/5" : "bg-surface/80"}`}>
        <Text className="text-[12px] font-semibold text-accent">适用场景</Text>
        <Text className="mt-1 text-[13px] leading-5 text-foreground">{card.scene}</Text>
      </View>

      <Text className="mt-4 text-[13px] font-semibold text-foreground">核心原则</Text>
      <View className="mt-2 space-y-3">
        {card.core.map((line, i) => (
          <View key={i} className="flex-row gap-2.5">
            <View className="mt-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
            <Text className="flex-1 text-[13px] leading-[21px] text-foreground/85">{line}</Text>
          </View>
        ))}
      </View>

      <View className={`mt-4 rounded-2xl border p-3.5 ${dark ? "border-white/8 bg-white/5" : "border-border bg-surface/70"}`}>
        <Text className="text-[12px] font-semibold text-foreground">使用要点</Text>
        <Text className="mt-1 text-[12.5px] leading-5 text-foreground/75">{card.usage}</Text>
        <View className="mt-2.5 h-px bg-border" />
        <Text className="mt-2.5 text-[12px] font-semibold text-foreground">禁用提醒</Text>
        <Text className="mt-1 text-[12.5px] leading-5 text-foreground/75">{card.forbid}</Text>
      </View>

      <View className={`mt-4 rounded-2xl px-4 py-3 ${dark ? "bg-white/10" : "bg-foreground"}`}>
        <Text className={`text-[13px] leading-5 ${dark ? "text-white/90" : "text-surface"}`}>小结 · {card.summary}</Text>
      </View>
    </LinearGradient>
  );
}

/* 闪卡自测 */
function FlashCard({ card, index, total, onPrev, onNext }: { card: MethodCard; index: number; total: number; onPrev: () => void; onNext: () => void }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); }, [card.id]);
  return (
    <View className="px-4 pt-2">
      <TouchableOpacity activeOpacity={0.85} onPress={() => setRevealed((r) => !r)}>
        <LinearGradient
          colors={["#3F3A36", "#2B2724"]}
          className="rounded-[24px] p-6 min-h-[300px] justify-between"
        >
          <View>
            <Text className="text-[11px] text-white/40 tracking-wider">闪卡自测 · {index + 1}/{total} · 点卡片翻面</Text>
            <Text className="mt-3 text-[15px] leading-6 text-white/85">
              场景：{card.scene}{"\n"}这道题你会怎么开口？
            </Text>
          </View>
          {revealed ? (
            <View>
              <Text className="text-[22px] font-bold text-white">{card.title}</Text>
              <Text className="mt-1 text-[11px] text-white/45">{card.source}</Text>
              <Text className="mt-3 text-[13px] leading-5 text-white/80">{card.core[0]}</Text>
              <View className="mt-3 rounded-xl px-3.5 py-2.5 bg-white/10">
                <Text className="text-[12px] leading-4 text-white/75">小结 · {card.summary}</Text>
              </View>
            </View>
          ) : (
            <Text className="text-[13px] text-white/40">👆 想好了就点我揭晓</Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
      <View className="flex-row items-center justify-between mt-3">
        <TouchableOpacity onPress={onPrev} className="px-4 h-9 rounded-full bg-surface border border-border items-center justify-center">
          <Text className="text-[13px] text-foreground">‹ 上一题</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setRevealed((r) => !r)} className="px-4 h-9 rounded-full bg-accent items-center justify-center">
          <Text className="text-[13px] text-white font-medium">{revealed ? "藏起来" : "翻面"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onNext} className="px-4 h-9 rounded-full bg-surface border border-border items-center justify-center">
          <Text className="text-[13px] text-foreground">下一题 ›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function AcademyScreen() {
  const [tab, setTab] = useState<"learn" | "phrase">("learn");
  const [mode, setMode] = useState<"list" | "flash">("list");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [favs, setFavs] = useState<string[]>([]);
  const [flashIdx, setFlashIdx] = useState(0);
  const { usage } = useMethodUsage();
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";

  // 每日一招：按一年中的第几天轮换，每天固定一招
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const daily = METHOD_CARDS[dayOfYear % METHOD_CARDS.length];
  const dailyIdx = METHOD_CARDS.findIndex((c) => c.id === daily.id);
  const [dailyOpen, setDailyOpen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("echo_mentor_fav_phrases").then((v) => {
      try { setFavs(JSON.parse(v || "[]")); } catch { /* ignore */ }
    });
  }, [tab]);

  const toggleFav = async (phrase: string) => {
    const next = favs.includes(phrase) ? favs.filter((x) => x !== phrase) : [...favs.filter((x) => x !== phrase), phrase];
    setFavs(next);
    try { await AsyncStorage.setItem("echo_mentor_fav_phrases", JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <Screen>
      <View className="px-5 pb-3 pt-2">
        <Text className="text-[28px] font-bold text-foreground tracking-tight">沟通学院</Text>
        <Text className="mt-1 text-[12.5px] text-foreground/55">{METHOD_CARDS.length} 套方法论，学一招、用一招、见证一招</Text>
      </View>

      {/* 顶栏：学习 / 话术速查 */}
      <View className="px-5 pb-3">
        <View className="flex-row bg-on-surface rounded-full p-0.5 self-start">
          {([["learn", "学习"], ["phrase", "话术速查"]] as const).map(([key, label]) => (
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

      {tab === "learn" ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {/* 每日一招 */}
          <View className="rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 mb-3 flex-row items-center justify-between">
            <View className="flex-1 mr-2">
              <Text className="text-[12px] font-semibold text-accent">今日一招 · {daily.title}</Text>
              <Text className="text-[11.5px] text-foreground/60 mt-0.5" numberOfLines={1}>{daily.scene}</Text>
            </View>
            {usageBadge(daily.title, usage)}
          </View>
          <TouchableOpacity onPress={() => setDailyOpen((o) => !o)} className="self-start mb-1 ml-1">
            <Text className="text-[12px] text-accent font-medium">{dailyOpen ? "收起今日一招 ↑" : "展开今日一招 ↓"}</Text>
          </TouchableOpacity>
          {dailyOpen && <MethodPage card={daily} index={dailyIdx} />}

          {/* 模式切换：全部方法 / 闪卡自测 */}
          <View className="flex-row bg-on-surface rounded-full p-0.5 self-start mt-4 mb-3">
            {([["list", "全部方法"], ["flash", "闪卡自测"]] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                onPress={() => setMode(key)}
                className={`px-3.5 h-7 rounded-full items-center justify-center ${mode === key ? "bg-white shadow-sm" : ""}`}
              >
                <Text className={`text-[12px] ${mode === key ? "text-foreground font-semibold" : "text-foreground/60"}`}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {mode === "list" ? (
            <>
              <Text className="px-1 pb-2 text-[11.5px] text-foreground/45">点任意一招原地展开全文，再点收起。</Text>
              {METHOD_CARDS.map((card, i) => {
                const open = !!expanded[card.id];
                return (
                  <View key={card.id} className="mb-2">
                    <TouchableOpacity
                      onPress={() => setExpanded((s) => ({ ...s, [card.id]: !s[card.id] }))}
                      className="bg-surface border border-border rounded-2xl px-4 py-3.5 flex-row items-center justify-between"
                    >
                      <View className="flex-1 mr-2">
                        <View className="flex-row items-center gap-2 flex-wrap">
                          <Text className="text-[15px] font-semibold text-foreground">{card.title}</Text>
                          {usageBadge(card.title, usage)}
                        </View>
                        <Text className="text-[11.5px] text-foreground/55 mt-0.5" numberOfLines={1}>{card.scene}</Text>
                      </View>
                      <Text className="text-[12px] text-muted">{open ? "收起 ↑" : "展开 ↓"}</Text>
                    </TouchableOpacity>
                    {open && <MethodPage card={card} index={i} />}
                  </View>
                );
              })}
            </>
          ) : (
            <FlashCard
              card={METHOD_CARDS[flashIdx % METHOD_CARDS.length]}
              index={flashIdx % METHOD_CARDS.length}
              total={METHOD_CARDS.length}
              onPrev={() => setFlashIdx((i) => (i - 1 + METHOD_CARDS.length) % METHOD_CARDS.length)}
              onNext={() => setFlashIdx((i) => (i + 1) % METHOD_CARDS.length)}
            />
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
          <Text className="px-1 pb-2 text-[12px] leading-5 text-foreground/50">
            句式供直接参考（点 ☆ 收藏常用句，分析时 AI 会模仿你的表达习惯）。
          </Text>
          {favs.length > 0 && (
            <View className="rounded-2xl px-4 py-3 mb-4 border border-accent/30" style={{ backgroundColor: dark ? "rgba(91,192,222,0.10)" : "rgba(91,192,222,0.08)" }}>
              <Text className="text-[12px] font-semibold text-accent mb-1">我的收藏（{favs.length}）· 已作为你的风格样本喂给 AI</Text>
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
    </Screen>
  );
}
