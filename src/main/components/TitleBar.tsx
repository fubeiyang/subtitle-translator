// Custom title bar for frameless window — draggable, with window controls
interface Props {
  onSettings: () => void;
  showSettings: boolean;
}

export default function TitleBar({ onSettings, showSettings }: Props) {
  return (
    <div className="title-bar">
      {/* Window controls */}
      <div className="window-controls">
        <button
          className="wc-btn wc-close"
          onClick={() => window.electronAPI.closeWindow()}
          title="关闭"
        />
        <button
          className="wc-btn wc-minimize"
          onClick={() => window.electronAPI.minimizeWindow()}
          title="最小化"
        />
      </div>

      <span className="title-text">字幕翻译</span>

      {showSettings && (
        <button className="settings-btn" onClick={onSettings} title="设置">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 15.5A3.5 3.5 0 018.5 12 3.5 3.5 0 0112 8.5a3.5 3.5 0 013.5 3.5 3.5 3.5 0 01-3.5 3.5m7.43-2.92c.04-.3.07-.62.07-.96 0-.34-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1 0 .33.03.65.07.96l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z" />
          </svg>
        </button>
      )}
    </div>
  );
}
