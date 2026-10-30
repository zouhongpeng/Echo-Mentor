import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { FontAwesome6 } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import React from "react";
import {
  getUsage,
  getDsModel,
  setDsModel,
  MODELS,
  fmtCny,
  fmtTokens,
  resetUsage,
  type UsageTotals,
  type ModelId,
} from "@/utils/usage";

/**
 * 用量面板（深色卡片）
 * - 主指标：累计花费（元）；两项关联指标：输入/输出 tokens
 * - 隐私开关：一键把所有数值模糊成 •••
 * - 模型切换：Flash / V4 Pro，切换后立即影响后续分析
 */
export default function UsageCard() {
  const [u, setU] = useState<UsageTotals | null>(null);
  const [model, setModel] = useState<ModelId>("deepseek-flash");
  const [masked, setMasked] = useState(false);

  const load = React.useCallback(async () => {
    setU(await getUsage());
    setModel(await getDsModel());
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(React.useCallback(() => { load(); }, [load]));

  const pick = async (m: ModelId) => {
    setModel(m);
    await setDsModel(m);
  };

  const hide = (v: string) => (masked ? "•••" : v);
  const total = u ? u.prompt + u.completion : 0;

  return (
    <View
      className="mx-4 mt-4 mb-2 rounded-3xl overflow-hidden"
      style={{ backgroundColor: "#1B1917", borderWidth: 1, borderColor: "rgba(255,255,255,0.07)" }}
    >
      <View className="px-5 pt-4 pb-5">
        {/* 标题行 */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#E4572E" }} />
            <Text className="ml-2 text-[13px] font-semibold" style={{ color: "#F5F3EE" }}>用量面板</Text>
          </View>
          <TouchableOpacity
            onPress={() => setMasked((v) => !v)}
            hitSlop={10}
            className="flex-row items-center px-2.5 h-7 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
          >
            <FontAwesome6 name={masked ? "eye-slash" : "eye"} size={11} color="#B8B2A8" />
            <Text className="ml-1.5 text-[11px]" style={{ color: "#B8B2A8" }}>{masked ? "已隐藏" : "显示中"}</Text>
          </TouchableOpacity>
        </View>

        {/* 主指标 */}
        <View className="flex-row items-end mt-3.5">
          <Text className="text-[15px] mr-0.5" style={{ color: "#B8B2A8" }}>¥</Text>
          <Text className="text-[34px] font-bold leading-9" style={{ color: "#F5F3EE", letterSpacing: -0.5 }}>
            {hide(fmtCny(u?.costCny ?? 0))}
          </Text>
          <Text className="ml-2 mb-1 text-[11.5px]" style={{ color: "#7E786E" }}>
            {masked ? "" : `≈ ${fmtTokens(total)} tokens`}
          </Text>
        </View>

        {/* 两项关联指标 */}
        <View className="flex-row mt-4" style={{ gap: 10 }}>
          <View className="flex-1 rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
            <Text className="text-[10.5px]" style={{ color: "#8A847A" }}>输入 tokens</Text>
            <Text className="mt-1 text-[16px] font-semibold" style={{ color: "#F5F3EE" }}>
              {hide(fmtTokens(u?.prompt ?? 0))}
            </Text>
          </View>
          <View className="flex-1 rounded-2xl px-3.5 py-2.5" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
            <Text className="text-[10.5px]" style={{ color: "#8A847A" }}>输出 tokens</Text>
            <Text className="mt-1 text-[16px] font-semibold" style={{ color: "#F5F3EE" }}>
              {hide(fmtTokens(u?.completion ?? 0))}
            </Text>
          </View>
        </View>

        {/* 模型选择 */}
        <Text className="mt-5 mb-2 text-[11px]" style={{ color: "#8A847A" }}>分析模型</Text>
        <View className="flex-row" style={{ gap: 8 }}>
          {MODELS.map((m) => {
            const on = model === m.id;
            return (
              <TouchableOpacity
                key={m.id}
                onPress={() => pick(m.id)}
                activeOpacity={0.85}
                className="flex-1 rounded-2xl px-3 py-2.5"
                style={{
                  backgroundColor: on ? "rgba(228,87,46,0.16)" : "rgba(255,255,255,0.05)",
                  borderWidth: 1,
                  borderColor: on ? "rgba(228,87,46,0.55)" : "transparent",
                }}
              >
                <View className="flex-row items-center">
                  <View
                    style={{
                      width: 6, height: 6, borderRadius: 3,
                      backgroundColor: on ? "#E4572E" : "#5C564D",
                    }}
                  />
                  <Text className="ml-1.5 text-[12.5px] font-semibold" style={{ color: on ? "#F2A78F" : "#D7D2C8" }}>
                    {m.name}
                  </Text>
                </View>
                <Text className="mt-1 text-[10.5px]" style={{ color: "#7E786E" }}>{m.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 底部说明 */}
        <View className="flex-row items-center justify-between mt-4">
          <Text className="text-[10.5px]" style={{ color: "#6F6A61" }}>
            {u?.calls ?? 0} 次调用 · 按官方单价估算
          </Text>
          <TouchableOpacity onPress={async () => { await resetUsage(); load(); }} hitSlop={8}>
            <Text className="text-[10.5px]" style={{ color: "#6F6A61" }}>清零统计</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
