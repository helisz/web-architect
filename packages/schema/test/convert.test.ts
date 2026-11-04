import { describe, expect, it } from 'vitest';
import {
  assembleDiagram,
  edgeToRow,
  groupToRow,
  nodeToRow,
  rowToEdge,
  rowToGroup,
  rowToNode,
} from '../src/convert.js';
import type { DiagramMasterRow } from '../src/convert.js';
import { sample } from './fixtures.js';

const masterRow: DiagramMasterRow = {
  diagram_id: sample.diagramId,
  schema_version: sample.schemaVersion,
  name: sample.name,
  description: sample.description,
  project_id: null,
  tags: [],
  version: sample.version,
  creator_id: sample.creatorId,
  created_at: sample.createdAt,
  updated_at: sample.updatedAt,
  viewport_x: sample.viewport.x,
  viewport_y: sample.viewport.y,
  viewport_zoom: sample.viewport.zoom,
  is_deleted: false,
};

describe('convert 往返（对应验收 D1 / D2）', () => {
  it('对象 → row → assemble 与原始 Schema 深比较一致', () => {
    const rebuilt = assembleDiagram(
      masterRow,
      sample.groups.map((g) => groupToRow(g, sample.diagramId)),
      sample.nodes.map((n) => nodeToRow(n, sample.diagramId)),
      sample.edges.map((e) => edgeToRow(e, sample.diagramId)),
    );
    expect(rebuilt).toEqual(sample);
  });

  it('单条边往返保留线型、锚点、虚线', () => {
    const dashed = sample.edges.find((e) => e.strokeDasharray === '4,4')!;
    const back = rowToEdge(edgeToRow(dashed, sample.diagramId));
    expect(back).toEqual(dashed);
  });

  it('节点往返保留 subLabel 的多行内容', () => {
    const waf = sample.nodes.find((n) => n.label === 'WAF')!;
    expect(waf.subLabel.split('\n')).toHaveLength(2);
    expect(rowToNode(nodeToRow(waf, sample.diagramId))).toEqual(waf);
  });

  it('分组往返保留 collapsed 与三色', () => {
    const dmz = sample.groups[0]!;
    const back = rowToGroup(groupToRow(dmz, sample.diagramId));
    expect(back).toEqual(dmz);
  });

  it('isDeleted 在输出侧恒为 false（软删对前端透明）', () => {
    const dmz = sample.groups[0]!;
    expect(rowToGroup(groupToRow(dmz, sample.diagramId)).isDeleted).toBe(false);
  });
});
