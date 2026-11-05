/**
 * 解析用的提示词（用户 2026-11-05）。
 *
 * 设计要点（都是踩过的坑）：
 * - 坐标用 **0–1 归一化 + 左上角**，不让模型猜像素：它不知道原图多大，
 *   一旦让它给像素值，就会按"常见画布 1920×1080"瞎编；
 * - 类型必须从固定清单里选，模型自由发挥的类型（"application server"）我们认不出；
 * - 分组只要求给成员 key，边界框由我们算，避免模型把框画歪；
 * - 明确"不要臆造""看不清就省略"，否则它会为了凑数编出整层不存在的服务。
 */

import { COMPONENT_INDEX } from '@arch/schema';
import { AI_NODE_TYPES } from './parseSchema.js';

/** 每个类型补一句"什么时候用它"，比只给中文名准确率高 */
const TYPE_HINTS: Record<(typeof AI_NODE_TYPES)[number], string> = {
  firewall: '防火墙 / 安全组',
  waf: 'WAF / Web 应用防火墙',
  vip: 'VIP / 虚拟 IP / 浮动地址',
  lb: '负载均衡 / SLB / F5 / LVS',
  vpn: 'VPN / 专线 / IPsec 网关',
  ids: 'IDS / IPS / 入侵检测 / 堡垒机',
  server: '普通服务器 / 主机 / 物理机 / 中间件',
  vm: '虚拟机 / 云主机（ECS、EC2）',
  container: 'Docker / 容器 / 镜像仓库',
  nginx: 'Nginx',
  proxy: '代理 / 反向代理（非 Nginx）',
  'k8s-cluster': 'Kubernetes / K8s 集群',
  namespace: '命名空间 / Namespace',
  deployment: 'Deployment / 工作负载 / 副本集',
  service: 'K8s Service / 服务对象',
  pod: 'Pod',
  ingress: 'Ingress / 入口控制器',
  db: '数据库 / 缓存 / 消息队列 / 对象存储',
  gateway: 'API 网关 / 业务网关',
  external: '互联网 / 用户 / 客户端 / CDN / DNS / 第三方系统',
  switch: '交换机',
  router: '路由器',
  subnet: '子网 / VPC / 网段',
  custom: '认不出类型的普通方块（业务模块、平台、系统）',
};

export function nodeCatalogText(): string {
  return AI_NODE_TYPES.map((type) => {
    const label = COMPONENT_INDEX[type]?.label ?? type;
    return `  - ${type}（${label}）：${TYPE_HINTS[type]}`;
  }).join('\n');
}

export function buildParsePrompt(): string {
  return `你是一名资深架构师。请把这张架构图截图还原成结构化 JSON，供绘图工具重新绘制。

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要 markdown 代码围栏（\`\`\`），不要在 JSON 前后写任何解释。

{
  "name": "整张图的名字（图上没有就用最能概括内容的短语）",
  "nodes": [
    { "key": "web-1", "label": "Web 服务器", "subLabel": "10.0.0.11:80", "type": "server", "x": 0.18, "y": 0.32, "w": 0.1, "h": 0.07 }
  ],
  "edges": [
    { "from": "web-1", "to": "db-1", "label": "SQL 3306", "dashed": false }
  ],
  "groups": [
    { "label": "DMZ ZONE", "subLabel": "对外服务区", "members": ["web-1"] }
  ]
}

## 坐标规则
- x、y 是节点**左上角**在图片中的相对位置：图片左边缘 = 0，右边缘 = 1，上边缘 = 0，下边缘 = 1。
- 必须按图上真实位置估算，不要为了整齐按行列等距排布。
- w、h 是节点宽高相对整张图的比例；估不出来可以省略（我们会用默认尺寸）。

## 节点规则
- label 照抄图上的文字（简体中文优先，保留英文专有名词），不要翻译、不要改写。
- subLabel 放图上的次要文字：IP、端口、域名、版本、副本数；没有就写空串。
- 一个图标 + 一段文字 = 一个节点；不要把同一元素拆成两个节点，也不要把标题/图例当节点。
- key 用简短的英文或拼音，必须全局唯一，edges/groups 用它引用。

## 连线规则
- 方向按箭头；没有箭头时按"调用方 → 被调方"或"上层 → 下层"。
- label 填线上的文字（协议、端口、说明），没有就不写这个字段。
- 虚线（管理链路、备份、监控）标 "dashed": true。
- 所有 from/to 必须是上面 nodes 里出现过的 key。

## 分组 / 边界框
- 图上真实画了标题的框（DMZ、内网、K8s 集群、区域）才写进 groups，成员列 key。
- 不要自己发明分组；没有边界框就返回空数组。

## 类型清单（type 只能从这里选）
${nodeCatalogText()}

## 底线
- 只输出图中真实存在的内容：看不清的宁可省略，绝对不要臆造节点、IP 和连线。
- 最多 80 个节点；超过时优先保留边界框内和连线最多的节点。`;
}

/** 第一次输出不是合法 JSON 时，重发一次，语气更强 */
export function buildRepairPrompt(previousAttempt: string): string {
  const clipped = previousAttempt.slice(0, 400);
  return `${buildParsePrompt()}

## 重要：上一次的输出无法解析
上一次你返回的内容开头是：
"""
${clipped}
"""
这次必须只返回**纯 JSON 对象**：第一个字符是 {，最后一个字符是 }，不要任何说明文字、不要代码围栏、不要结尾逗号。`;
}
