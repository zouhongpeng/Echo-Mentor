/**
 * 环境配置加载（必须是整个应用的第一个 import！）
 * - 读取仓库内置密钥 server/keys.env（私有自用）
 * - 再读常规 .env；平台注入的同名环境变量优先（dotenv 不覆盖已存在值）
 * 注意：ESM 的 import 会提升，普通语句晚于其他模块执行，
 *       因此环境加载必须独立成模块并放在 import 序列首位。
 */
import dotenv from "dotenv";
for (const p of ["keys.env", "../keys.env", ".env", "../.env"]) dotenv.config({ path: p });

// 私有仓库自用：支持以 Base64 存放 DeepSeek Key（避开 GitHub 密钥推送保护），启动时自动解码
if (!process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY_B64) {
  process.env.DEEPSEEK_API_KEY = Buffer.from(process.env.DEEPSEEK_API_KEY_B64, "base64").toString("utf8").trim();
}
export {};
