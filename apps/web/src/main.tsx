import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { useDiagramStore } from './store/useDiagramStore.js';
import '@xyflow/react/dist/style.css';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root 未找到');

// 开发期调试入口：控制台可直接看/改 store（生产构建不包含）
if (import.meta.env.DEV) {
  (window as unknown as { __archStore: typeof useDiagramStore }).__archStore = useDiagramStore;
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
