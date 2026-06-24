// Settings page — API key management, translation service, display options
import { useState, useEffect } from 'react';
import { loadSettings, saveSettings } from '../../services/settingsStore';

interface Props {
  onBack: () => void;
}

export default function SettingsPage({ onBack }: Props) {
  const [deepgramKey, setDeepgramKey] = useState('');
  const [showDeepgramKey, setShowDeepgramKey] = useState(false);
  const [translationService, setTranslationService] = useState<'google' | 'deepl' | 'claude'>('google');
  const [deeplKey, setDeeplKey] = useState('');
  const [showDeeplKey, setShowDeeplKey] = useState(false);
  const [claudeKey, setClaudeKey] = useState('');
  const [showClaudeKey, setShowClaudeKey] = useState(false);
  const [claudeBaseUrl, setClaudeBaseUrl] = useState('');
  const [claudeModel, setClaudeModel] = useState('');
  const [fontSize, setFontSize] = useState(28);
  const [opacity, setOpacity] = useState(90);
  const [proxyPort, setProxyPort] = useState('7890');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then((s) => {
      setDeepgramKey(s.deepgramApiKey ?? '');
      setTranslationService(s.translationService ?? 'google');
      setDeeplKey(s.deeplApiKey ?? '');
      setClaudeKey(s.claudeApiKey ?? '');
      setClaudeBaseUrl(s.claudeBaseUrl ?? '');
      setClaudeModel(s.claudeModel ?? '');
      setFontSize(s.overlayFontSize ?? 28);
      setOpacity(s.overlayOpacity ?? 90);
      setProxyPort(s.proxyPort ?? '7890');
    });
  }, []);

  const [testResult, setTestResult] = useState('');

  const handleSave = async () => {
    await saveSettings({
      deepgramApiKey: deepgramKey.trim(),
      translationService,
      deeplApiKey: deeplKey.trim(),
      claudeApiKey: claudeKey.trim(),
      claudeBaseUrl: claudeBaseUrl.trim(),
      claudeModel: claudeModel.trim(),
      overlayFontSize: fontSize,
      overlayOpacity: opacity,
      proxyPort: proxyPort.trim() || '7890',
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestKey = async () => {
    setTestResult('测试中...');
    const key = deepgramKey.trim();
    if (!key) { setTestResult('请先输入 API Key'); return; }
    const r = await (window as any).electronAPI.deepgramTestKey(key);
    const msg = `HTTP ${r.status}: ${r.body.slice(0, 200)}`;
    setTestResult(msg);
    console.log('[KEY TEST]', msg);
  };

  return (
    <div className="settings-page">
      {/* Back button */}
      <button className="back-btn" onClick={onBack}>
        ← 返回
      </button>

      <h2 className="settings-title">设置</h2>

      {/* ── Network / Proxy ── */}
      <section className="settings-section">
        <div className="settings-section-title">网络代理</div>
        <div className="settings-field">
          <label>Clash 代理端口</label>
          <p className="settings-hint">
            打开 Clash → 常规，查看"混合代理端口"或"HTTP代理端口"，填在此处（默认 7890）
          </p>
          <input
            type="text"
            className="text-input"
            value={proxyPort}
            onChange={(e) => setProxyPort(e.target.value.replace(/\D/g, ''))}
            placeholder="7890"
            maxLength={5}
            style={{ width: 100 }}
          />
        </div>
      </section>

      {/* ── API Keys ── */}
      <section className="settings-section">
        <div className="settings-section-title">API 密钥</div>

        <div className="settings-field">
          <label>Deepgram API Key</label>
          <p className="settings-hint">
            免费注册：
            <span className="link-text">console.deepgram.com</span>
            （每月 $200 免费额度）
          </p>
          <div className="key-input-row">
            <input
              type={showDeepgramKey ? 'text' : 'password'}
              className="text-input"
              value={deepgramKey}
              onChange={(e) => setDeepgramKey(e.target.value)}
              placeholder="请输入您的 Deepgram API Key"
              spellCheck={false}
            />
            <button
              className="show-key-btn"
              onClick={() => setShowDeepgramKey((v) => !v)}
              title={showDeepgramKey ? '隐藏' : '显示'}
            >
              {showDeepgramKey ? '🙈' : '👁️'}
            </button>
          </div>
          <button className="show-key-btn" style={{marginTop:6}} onClick={handleTestKey}>
            🔍 测试 Key
          </button>
          {testResult && (
            <p style={{fontSize:11, marginTop:4, wordBreak:'break-all', color: testResult.includes('HTTP 200') ? 'green' : 'red'}}>
              {testResult}
            </p>
          )}
        </div>

        <div className="settings-field">
          <label>翻译服务</label>
          <div className="radio-group">
            <label className="radio-label">
              <input
                type="radio"
                value="google"
                checked={translationService === 'google'}
                onChange={() => setTranslationService('google')}
              />
              <span>Google 翻译（免费，无需 Key）</span>
            </label>
            <label className="radio-label">
              <input
                type="radio"
                value="deepl"
                checked={translationService === 'deepl'}
                onChange={() => setTranslationService('deepl')}
              />
              <span>DeepL（更精准，需要 Key）</span>
            </label>
            <label className="radio-label">
              <input
                type="radio"
                value="claude"
                checked={translationService === 'claude'}
                onChange={() => setTranslationService('claude')}
              />
              <span>自定义 AI（最佳质量，上下文感知，需要 Key）</span>
            </label>
          </div>
        </div>

        {translationService === 'deepl' && (
          <div className="settings-field">
            <label>DeepL API Key</label>
            <p className="settings-hint">免费版 50万字/月：deepl.com/pro-api</p>
            <div className="key-input-row">
              <input
                type={showDeeplKey ? 'text' : 'password'}
                className="text-input"
                value={deeplKey}
                onChange={(e) => setDeeplKey(e.target.value)}
                placeholder="请输入 DeepL API Key（以 :fx 结尾为免费版）"
                spellCheck={false}
              />
              <button
                className="show-key-btn"
                onClick={() => setShowDeeplKey((v) => !v)}
                title={showDeeplKey ? '隐藏' : '显示'}
              >
                {showDeeplKey ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
        )}

        {translationService === 'claude' && (
          <div className="settings-field">
            <label>API 基础路径 (Base URL)</label>
            <p className="settings-hint">
              留空 = 使用 Anthropic 官方接口；填写国内大厂或中转地址可直接访问，无需代理。
              例：<span className="link-text">https://api.openai.com</span>
            </p>
            <input
              type="text"
              className="text-input"
              value={claudeBaseUrl}
              onChange={(e) => setClaudeBaseUrl(e.target.value)}
              placeholder="留空使用 Anthropic 官方，或填写如 https://api.siliconflow.cn"
              spellCheck={false}
            />

            <label style={{ marginTop: 10 }}>模型名称 (Model)</label>
            <p className="settings-hint">
              留空 = 自动选择默认模型。国内大厂请填写对应模型，如 qwen-plus、deepseek-chat、moonshot-v1-8k 等。
            </p>
            <input
              type="text"
              className="text-input"
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value)}
              placeholder="留空自动，或填写如 qwen-plus / gpt-4o-mini / deepseek-chat"
              spellCheck={false}
            />

            <label style={{ marginTop: 10 }}>API 密钥 (API Key)</label>
            <div className="key-input-row">
              <input
                type={showClaudeKey ? 'text' : 'password'}
                className="text-input"
                value={claudeKey}
                onChange={(e) => setClaudeKey(e.target.value)}
                placeholder="请输入 API Key"
                spellCheck={false}
              />
              <button
                className="show-key-btn"
                onClick={() => setShowClaudeKey((v) => !v)}
                title={showClaudeKey ? '隐藏' : '显示'}
              >
                {showClaudeKey ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Display ── */}
      <section className="settings-section">
        <div className="settings-section-title">字幕显示</div>

        <div className="settings-field">
          <label>字体大小 {fontSize}px</label>
          <input
            type="range"
            min={16}
            max={48}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="slider"
          />
        </div>

        <div className="settings-field">
          <label>字幕条不透明度 {opacity}%</label>
          <input
            type="range"
            min={40}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="slider"
          />
        </div>
      </section>

      {/* Save button */}
      <button className={`save-btn ${saved ? 'save-btn--ok' : ''}`} onClick={handleSave}>
        {saved ? '✓ 已保存' : '保存设置'}
      </button>
    </div>
  );
}
