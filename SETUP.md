# 字幕翻译 — 快速上手

## 一、获取 Deepgram API Key（必须）

1. 访问 https://console.deepgram.com 免费注册
2. 创建项目，复制 API Key（每月 $200 免费额度）
3. 打开软件 → 点击右上角齿轮 → 粘贴 Key → 保存

---

## 二、开发模式运行

```bash
npm install
npm run dev
```

## 三、打包发布

```bash
# Windows 打包 → 生成 release/*.exe 安装包
npm run dist:win

# macOS 打包 → 生成 release/*.dmg
npm run dist:mac
```

---

## 四、系统音频捕获说明

### Windows（开箱即用）
- 软件使用 WASAPI Loopback 直接捕获系统播放的声音
- **无需安装任何虚拟声卡**，插上耳机或外放都能捕获

### macOS（需额外配置）
1. 安装 BlackHole（免费虚拟声卡）：https://github.com/ExistentialAudio/BlackHole
2. 在系统设置 → 声音 → 输出，选择 "BlackHole 2ch"
3. 在"音频 MIDI 设置"中创建多输出设备（同时输出到耳机+BlackHole）
4. 启动软件后，选择 BlackHole 作为采集源

---

## 五、技术架构

```
音频采集流程：
  getDisplayMedia() [WASAPI Loopback on Windows]
    → AudioContext (16 kHz 重采样)
      → ScriptProcessorNode (4096 samples, ~256ms)
        → Float32 → Int16 PCM 转换
          → Deepgram WebSocket

Deepgram 流程：
  WebSocket → nova-3 模型 → 流式文字
    interim_results → 立即显示（不翻译）
    speech_final    → 翻译 → 显示中文字幕

翻译流程：
  Google Translate (无需Key) 或 DeepL API (可选)

窗口架构：
  主控制窗口 (460×700, 毛玻璃, 无边框)
  悬浮字幕窗口 (900×130, 透明, 始终最前)
```
