import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  Connection,
  Edge,
  Node,
  NodeTypes,
  Handle,
  Position,
  MarkerType,
  useReactFlow,
  Panel,
  ReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────
type NodeKind = 'start' | 'end' | 'agent' | 'router' | 'hitl';

interface NodeData extends Record<string, unknown> {
  label: string;
  kind: NodeKind;
  agentId?: string;
  agentName?: string;
  condition?: string;
  description?: string;
}

// ────────────────────────────────────────────────────
// Colour palette per node kind
// ────────────────────────────────────────────────────
const KIND_STYLE: Record<NodeKind, { bg: string; border: string; text: string; icon: string }> = {
  start: { bg: '#dcfce7', border: '#16a34a', text: '#15803d', icon: '▶' },
  end:   { bg: '#fee2e2', border: '#dc2626', text: '#b91c1c', icon: '■' },
  agent: { bg: '#dbeafe', border: '#2563eb', text: '#1d4ed8', icon: '🤖' },
  router:{ bg: '#fef3c7', border: '#d97706', text: '#b45309', icon: '⧖' },
  hitl:  { bg: '#ede9fe', border: '#7c3aed', text: '#6d28d9', icon: '👤' },
};

// ────────────────────────────────────────────────────
// Custom node components
// ────────────────────────────────────────────────────
function AgentNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const s = KIND_STYLE[data.kind];
  return (
    <div
      style={{
        background: s.bg,
        border: `2px solid ${selected ? '#1d4ed8' : s.border}`,
        borderRadius: 12,
        padding: '10px 16px',
        minWidth: 160,
        boxShadow: selected ? `0 0 0 3px ${s.border}44` : '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'box-shadow 0.15s',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: s.border }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{s.icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: s.text }}>{data.label}</div>
          {data.agentName && (
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>{data.agentName}</div>
          )}
          {data.description && (
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1, maxWidth: 160 }}>{data.description}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: s.border }} />
    </div>
  );
}

function RouterNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const s = KIND_STYLE.router;
  return (
    <div
      style={{
        background: s.bg,
        border: `2px solid ${selected ? '#d97706' : s.border}`,
        borderRadius: 8,
        padding: '10px 14px',
        minWidth: 140,
        transform: 'rotate(0deg)',
        boxShadow: selected ? `0 0 0 3px ${s.border}44` : '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: s.border }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{s.icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: s.text }}>{data.label}</div>
          {data.condition && (
            <div style={{ fontSize: 11, color: '#78716c', fontFamily: 'monospace', marginTop: 2 }}>
              {data.condition}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="default" style={{ background: s.border, left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="branch" style={{ background: s.border, left: '70%' }} />
    </div>
  );
}

function HITLNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const s = KIND_STYLE.hitl;
  return (
    <div
      style={{
        background: s.bg,
        border: `2px dashed ${selected ? '#7c3aed' : s.border}`,
        borderRadius: 12,
        padding: '10px 16px',
        minWidth: 150,
        boxShadow: selected ? `0 0 0 3px ${s.border}44` : '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: s.border }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{s.icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: s.text }}>{data.label}</div>
          <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 1 }}>Awaits human approval</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: s.border }} />
    </div>
  );
}

function TerminalNode({ data, selected }: { data: NodeData; selected?: boolean }) {
  const s = KIND_STYLE[data.kind as 'start' | 'end'];
  const isStart = data.kind === 'start';
  return (
    <div
      style={{
        background: s.bg,
        border: `2px solid ${selected ? s.border : s.border}`,
        borderRadius: 999,
        padding: '8px 20px',
        fontWeight: 700,
        fontSize: 13,
        color: s.text,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: selected ? `0 0 0 3px ${s.border}44` : '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      {isStart && <Handle type="source" position={Position.Bottom} style={{ background: s.border }} />}
      {!isStart && <Handle type="target" position={Position.Top} style={{ background: s.border }} />}
      <span>{s.icon}</span>
      <span>{data.label}</span>
    </div>
  );
}

const NODE_TYPES: NodeTypes = {
  agent: AgentNode,
  router: RouterNode,
  hitl: HITLNode,
  start: TerminalNode,
  end: TerminalNode,
};

// ────────────────────────────────────────────────────
// Default initial graph
// ────────────────────────────────────────────────────
const DEFAULT_NODES: Node<NodeData>[] = [
  { id: 'start', type: 'start', position: { x: 300, y: 40 },  data: { label: 'START', kind: 'start' } },
  { id: 'agent1', type: 'agent', position: { x: 240, y: 140 }, data: { label: 'Researcher', kind: 'agent', description: 'Gathers information' } },
  { id: 'hitl1',  type: 'hitl',  position: { x: 240, y: 270 }, data: { label: 'Review Gate', kind: 'hitl' } },
  { id: 'router1',type: 'router',position: { x: 230, y: 400 }, data: { label: 'Route Output', kind: 'router', condition: 'type == "urgent"' } },
  { id: 'agent2', type: 'agent', position: { x: 100, y: 530 }, data: { label: 'Writer', kind: 'agent', description: 'Drafts content' } },
  { id: 'agent3', type: 'agent', position: { x: 390, y: 530 }, data: { label: 'Analyst', kind: 'agent', description: 'Deep analysis' } },
  { id: 'end',    type: 'end',   position: { x: 300, y: 660 }, data: { label: 'END', kind: 'end' } },
];

const DEFAULT_EDGES: Edge[] = [
  { id: 'e1', source: 'start',   target: 'agent1',  markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e2', source: 'agent1',  target: 'hitl1',   markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e3', source: 'hitl1',   target: 'router1', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e4', source: 'router1', target: 'agent2', sourceHandle: 'default', markerEnd: { type: MarkerType.ArrowClosed }, label: 'normal' },
  { id: 'e5', source: 'router1', target: 'agent3', sourceHandle: 'branch',  markerEnd: { type: MarkerType.ArrowClosed }, label: 'urgent', style: { stroke: '#d97706' } },
  { id: 'e6', source: 'agent2',  target: 'end',     markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e7', source: 'agent3',  target: 'end',     markerEnd: { type: MarkerType.ArrowClosed } },
];

// ────────────────────────────────────────────────────
// Sidebar palette entry
// ────────────────────────────────────────────────────
function PaletteItem({ kind, label }: { kind: NodeKind; label: string }) {
  const s = KIND_STYLE[kind];
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/reactflow-kind', kind);
    e.dataTransfer.effectAllowed = 'move';
  };
  return (
    <div
      draggable
      onDragStart={onDragStart}
      style={{
        background: s.bg,
        border: `2px solid ${s.border}`,
        borderRadius: kind === 'router' ? 8 : kind === 'start' || kind === 'end' ? 999 : 10,
        padding: '8px 12px',
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        userSelect: 'none',
        fontSize: 13,
        fontWeight: 600,
        color: s.text,
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 4px 12px ${s.border}44`)}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    >
      <span>{s.icon}</span>
      <span>{label}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Node property panel
// ────────────────────────────────────────────────────
interface PropPanelProps {
  node: Node<NodeData>;
  onUpdate: (id: string, data: Partial<NodeData>) => void;
  onDelete: (id: string) => void;
}

function PropPanel({ node, onUpdate, onDelete }: PropPanelProps) {
  const d = node.data;
  const s = KIND_STYLE[d.kind];

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg w-72 flex flex-col overflow-hidden">
      <div
        style={{ background: s.bg, borderBottom: `2px solid ${s.border}` }}
        className="px-4 py-3 flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{s.icon}</span>
          <span style={{ color: s.text }} className="font-semibold text-sm capitalize">{d.kind} Node</span>
        </div>
        <button
          onClick={() => onDelete(node.id)}
          className="text-red-400 hover:text-red-600 text-sm font-bold"
        >
          Delete
        </button>
      </div>
      <div className="p-4 space-y-3 overflow-y-auto flex-1">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Label</label>
          <input
            value={d.label}
            onChange={e => onUpdate(node.id, { label: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        {d.kind === 'agent' && (
          <>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Agent Name</label>
              <input
                value={d.agentName || ''}
                onChange={e => onUpdate(node.id, { agentName: e.target.value })}
                placeholder="e.g. Researcher"
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Description</label>
              <input
                value={d.description || ''}
                onChange={e => onUpdate(node.id, { description: e.target.value })}
                placeholder="What this agent does"
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </>
        )}
        {d.kind === 'router' && (
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Condition Expression</label>
            <input
              value={d.condition || ''}
              onChange={e => onUpdate(node.id, { condition: e.target.value })}
              placeholder='e.g. type == "urgent"'
              className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-yellow-400"
            />
            <p className="text-xs text-gray-400 mt-1">Used by router to pick the branch edge.</p>
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Node ID</label>
          <span className="text-xs font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded">{node.id}</span>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">Position</label>
          <span className="text-xs text-gray-500">x: {Math.round(node.position.x)}, y: {Math.round(node.position.y)}</span>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────
// Main canvas component (inside ReactFlowProvider)
// ────────────────────────────────────────────────────
let nodeIdCounter = 100;

function FlowCanvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(DEFAULT_NODES as Node<NodeData>[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(DEFAULT_EDGES);
  const [selectedNode, setSelectedNode] = useState<Node<NodeData> | null>(null);
  const [saved, setSaved] = useState(false);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges(eds =>
        addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed } }, eds)
      ),
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData('application/reactflow-kind') as NodeKind;
      if (!kind) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = `${kind}_${++nodeIdCounter}`;
      const newNode: Node<NodeData> = {
        id,
        type: kind,
        position,
        data: {
          label: kind.charAt(0).toUpperCase() + kind.slice(1),
          kind,
        },
      };
      setNodes(nds => [...nds, newNode]);
      setSelectedNode(newNode);
    },
    [screenToFlowPosition, setNodes]
  );

  const updateNodeData = useCallback((id: string, patch: Partial<NodeData>) => {
    setNodes(nds =>
      nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
    );
    setSelectedNode(prev =>
      prev?.id === id ? { ...prev, data: { ...prev.data, ...patch } as NodeData } : prev
    );
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  const handleSave = () => {
    const topology = { nodes, edges };
    console.log('Workflow topology:', JSON.stringify(topology, null, 2));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'workflow.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Left sidebar: palette */}
      <div className="w-56 bg-white border-r border-gray-200 flex flex-col p-4 gap-3 shrink-0 overflow-y-auto">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Node Palette</p>
        <p className="text-xs text-gray-400 mb-2">Drag onto canvas</p>
        <PaletteItem kind="start" label="Start" />
        <PaletteItem kind="agent" label="Agent" />
        <PaletteItem kind="router" label="Router" />
        <PaletteItem kind="hitl" label="HITL Breakpoint" />
        <PaletteItem kind="end" label="End" />

        <div className="mt-auto pt-4 border-t border-gray-100 space-y-1 text-xs text-gray-400">
          <p>🖱 Drag nodes to reposition</p>
          <p>🔗 Connect handles to create edges</p>
          <p>🖱 Click node to edit properties</p>
          <p>⌫ Select + Delete to remove</p>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={NODE_TYPES}
          fitView
          defaultEdgeOptions={{
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2 },
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d1d5db" />
          <Controls />
          <MiniMap
            nodeStrokeWidth={3}
            nodeColor={n => KIND_STYLE[(n.data as NodeData)?.kind]?.border || '#9ca3af'}
            style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}
          />

          {/* Top action bar */}
          <Panel position="top-right" style={{ display: 'flex', gap: 8, padding: '12px 16px' }}>
            <button
              onClick={exportJSON}
              className="px-3 py-1.5 text-sm font-medium bg-white border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 shadow-sm"
            >
              Export JSON
            </button>
            <button
              onClick={handleSave}
              className={`px-4 py-1.5 text-sm font-semibold rounded-lg shadow-sm transition-all ${
                saved ? 'bg-green-500 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {saved ? '✓ Saved' : 'Save Workflow'}
            </button>
          </Panel>

          {/* Top info */}
          <Panel position="top-left" style={{ padding: '12px 16px' }}>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm text-sm text-gray-600">
              <span className="font-semibold text-gray-800">{nodes.length}</span> nodes &nbsp;·&nbsp;
              <span className="font-semibold text-gray-800">{edges.length}</span> edges
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* Right sidebar: properties */}
      {selectedNode && (
        <div className="w-72 p-3 border-l border-gray-200 bg-gray-50 shrink-0 overflow-y-auto">
          <PropPanel
            node={selectedNode}
            onUpdate={updateNodeData}
            onDelete={deleteNode}
          />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────
// Export: wrap in provider
// ────────────────────────────────────────────────────
export default function WorkflowBuilderPage() {
  return (
    <div className="h-screen flex flex-col">
      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Workflow Topology Builder</h1>
          <p className="text-xs text-gray-500">Visually design your multi-agent workflows with drag-and-drop</p>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ReactFlowProvider>
          <FlowCanvas />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
