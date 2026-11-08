import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { useDiagramStore } from './store/useDiagramStore.js';
import { loadDiagram, saveDiagram, toSavePayload } from './data/diagramRepo.js';
import { createEdge, createEmptyDiagram, createGroup, createNode } from '@arch/schema';
import '@xyflow/react/dist/style.css';
import './styles/index.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root 未找到');

/**
 * 清理已下线功能留下的本机数据（用户 2026-11-08：AI 解析整体删除）。
 *
 * 旧版本把模型配置以加密串存在 `arch.ai.vault`，现在没有任何代码读它，
 * 留着只是脏数据 —— 启动时删一次即可，幂等。
 */
try {
  localStorage.removeItem('arch.ai.vault');
  localStorage.removeItem('arch.ai.vault.salt');
  localStorage.removeItem('arch.ai.staging');
} catch {
  // 隐私模式读不到 localStorage：不影响使用
}

/**
 * 调试/压测入口：控制台可直接看/改 store。
 *
 * 开发构建默认挂上；生产构建只有带 `?testhook` 时才挂 —— 性能验收要跑生产包
 * （dev 的 React 开发版 + HMR 会把帧时间放大好几倍），没有这个钩子就测不了。
 */
const testHook = import.meta.env.DEV || new URLSearchParams(window.location.search).has('testhook');
if (testHook) {
  (window as unknown as { __archStore: typeof useDiagramStore }).__archStore = useDiagramStore;
  // 压测脚本要用工厂函数造临时图，一起挂出去（同样只在调试/压测时存在）
  (window as unknown as { __archRepo: unknown }).__archRepo = {
    loadDiagram,
    saveDiagram,
    toSavePayload,
    createEmptyDiagram,
    createNode,
    createGroup,
    createEdge,
  };
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

