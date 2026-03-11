// Flow Builder — uses React 18 + React Flow 11 loaded from CDN (UMD globals)
// ReactFlow is available as window.ReactFlow after the script tag loads

(function () {
  'use strict';

  const {
    useState, useCallback, useRef, useEffect
  } = React;

  const {
    ReactFlow,
    ReactFlowProvider,
    addEdge,
    useNodesState,
    useEdgesState,
    useReactFlow,
    Controls,
    MiniMap,
    Background,
    BackgroundVariant,
    Handle,
    Position,
    MarkerType,
    Panel,
  } = window.ReactFlow;

  // ── Constants ──────────────────────────────────────────────────────────────
  const COLORS = ['#10b981','#ef4444','#f59e0b','#3b82f6','#ec4899','#a855f7'];

  const SHAPES = {
    process:  { label: 'Process',   bg: '#7c3aed', fg: '#fff' },
    decision: { label: 'Decision',  bg: '#6b7280', fg: '#fff' },
    start:    { label: 'Start/End', bg: '#eab308', fg: '#1a1a1a' },
    data:     { label: 'Data',      bg: '#10b981', fg: '#fff' },
  };

  const DEFAULT_NODES = [
    { id: 'n1', type: 'process',  position: { x: 60,  y: 220 }, data: { label: 'Start',    shape: 'start'    } },
    { id: 'n2', type: 'process',  position: { x: 270, y: 220 }, data: { label: 'Step 1',   shape: 'process'  } },
    { id: 'n3', type: 'process',  position: { x: 460, y: 210 }, data: { label: 'Check?',   shape: 'decision' } },
    { id: 'n4', type: 'process',  position: { x: 660, y: 110 }, data: { label: 'Yes Path', shape: 'process'  } },
    { id: 'n5', type: 'process',  position: { x: 660, y: 310 }, data: { label: 'No Path',  shape: 'process'  } },
  ];

  const DEFAULT_EDGES = [
    { id: 'e1', source: 'n1', target: 'n2', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' }, style: { stroke: '#10b981', strokeWidth: 2 } },
    { id: 'e2', source: 'n2', target: 'n3', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' }, style: { stroke: '#10b981', strokeWidth: 2 } },
    { id: 'e3', source: 'n3', target: 'n4', type: 'smoothstep', label: 'Yes', markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' }, style: { stroke: '#10b981', strokeWidth: 2 } },
    { id: 'e4', source: 'n3', target: 'n5', type: 'smoothstep', label: 'No',  markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' }, style: { stroke: '#ef4444', strokeWidth: 2 } },
  ];

  let nodeIdCounter = 10;
  function nextId() { return 'n' + (++nodeIdCounter); }
  function nextEdgeId() { return 'e' + (++nodeIdCounter); }

  // ── Custom Node ─────────────────────────────────────────────────────────────
  function FlowNode({ data, selected }) {
    const shape = data.shape || 'process';

    const handles = React.createElement(React.Fragment, null,
      React.createElement(Handle, { type: 'target', position: Position.Left,   id: 'l' }),
      React.createElement(Handle, { type: 'target', position: Position.Top,    id: 't' }),
      React.createElement(Handle, { type: 'source', position: Position.Right,  id: 'r' }),
      React.createElement(Handle, { type: 'source', position: Position.Bottom, id: 'b' }),
    );

    if (shape === 'decision') {
      return React.createElement('div', null,
        handles,
        React.createElement('div', { className: 'rf-decision-wrap' },
          React.createElement('div', { className: 'rf-decision-bg', style: selected ? { filter: 'drop-shadow(0 0 0 2px #f59e0b)' } : {} }),
          React.createElement('div', { className: 'rf-decision-text' }, data.label),
        )
      );
    }

    const cls = {
      process:  'rf-node-body rf-process',
      start:    'rf-node-body rf-start',
      data:     'rf-node-body rf-data',
    }[shape] || 'rf-node-body rf-process';

    const inner = shape === 'data'
      ? React.createElement('span', null, data.label)
      : data.label;

    return React.createElement('div', null,
      handles,
      React.createElement('div', { className: cls }, inner)
    );
  }

  const nodeTypes = { process: FlowNode };

  // ── Sidebar ─────────────────────────────────────────────────────────────────
  function Sidebar({ activeColor, setActiveColor, onAddNode, onExport, onImport, onClear,
                     selectedEdge, onEdgeLabelChange, onEdgeColorChange, onDeleteEdge,
                     selectedNode, onNodeLabelChange, onDeleteNode }) {

    const [newLabel, setNewLabel] = useState('');
    const [newShape, setNewShape] = useState('process');
    const [edgeLabel, setEdgeLabel] = useState('');

    useEffect(() => {
      setEdgeLabel(selectedEdge?.label || '');
    }, [selectedEdge?.id]);

    return React.createElement('div', { id: 'sidebar' },

      // Title
      React.createElement('div', { className: 'sb-section' },
        React.createElement('div', { className: 'sb-title' }, '⬡ Flow Builder'),
      ),

      // Palette — drag to canvas
      React.createElement('div', { className: 'sb-section' },
        React.createElement('div', { className: 'sb-label' }, 'Drag to canvas'),
        ...Object.entries(SHAPES).map(([type, def]) =>
          React.createElement('div', {
            key: type,
            className: 'palette-node',
            style: { background: def.bg, color: def.fg },
            draggable: true,
            onDragStart: e => {
              e.dataTransfer.setData('shape', type);
              e.dataTransfer.setData('label', def.label);
              e.dataTransfer.effectAllowed = 'move';
            },
          }, def.label)
        ),
      ),

      // Add by typing
      React.createElement('div', { className: 'sb-section' },
        React.createElement('div', { className: 'sb-label' }, 'Add Shape'),
        React.createElement('select', {
          value: newShape,
          onChange: e => setNewShape(e.target.value),
        }, ...Object.entries(SHAPES).map(([k, v]) =>
          React.createElement('option', { key: k, value: k }, v.label)
        )),
        React.createElement('input', {
          placeholder: 'Label…',
          value: newLabel,
          onChange: e => setNewLabel(e.target.value),
          onKeyDown: e => { if (e.key === 'Enter') { onAddNode(newShape, newLabel); setNewLabel(''); } },
        }),
        React.createElement('button', {
          className: 'btn-purple',
          onClick: () => { onAddNode(newShape, newLabel); setNewLabel(''); },
        }, '+ Add Shape'),
      ),

      // Arrow color
      React.createElement('div', { className: 'sb-section' },
        React.createElement('div', { className: 'sb-label' }, 'New Arrow Color'),
        React.createElement('div', { className: 'color-row' },
          ...COLORS.map(c => React.createElement('div', {
            key: c,
            className: 'cdot' + (c === activeColor ? ' active' : ''),
            style: { background: c },
            onClick: () => setActiveColor(c),
          }))
        ),
        React.createElement('div', { className: 'info-box' },
          '🔗 Drag from a port dot to connect nodes.',
        ),
      ),

      // Selected node panel
      selectedNode && React.createElement('div', { className: 'sb-section' },
        React.createElement('div', { className: 'sb-label' }, '✦ Selected Shape'),
        React.createElement('input', {
          key: selectedNode.id,
          defaultValue: selectedNode.data.label,
          placeholder: 'Label…',
          onBlur: e => onNodeLabelChange(selectedNode.id, e.target.value),
          onKeyDown: e => { if (e.key === 'Enter') onNodeLabelChange(selectedNode.id, e.target.value); },
        }),
        React.createElement('button', { className: 'btn-red', onClick: onDeleteNode }, '✕ Delete Shape'),
      ),

      // Selected edge panel
      selectedEdge && React.createElement('div', { className: 'sb-section' },
        React.createElement('div', { className: 'sb-label' }, '→ Selected Arrow'),
        React.createElement('input', {
          key: selectedEdge.id,
          value: edgeLabel,
          placeholder: 'Arrow label…',
          onChange: e => setEdgeLabel(e.target.value),
          onBlur: () => onEdgeLabelChange(selectedEdge.id, edgeLabel),
          onKeyDown: e => { if (e.key === 'Enter') onEdgeLabelChange(selectedEdge.id, edgeLabel); },
        }),
        React.createElement('div', { className: 'sb-label' }, 'Color'),
        React.createElement('div', { className: 'color-row' },
          ...COLORS.map(c => React.createElement('div', {
            key: c,
            className: 'cdot' + (selectedEdge.style?.stroke === c ? ' active' : ''),
            style: { background: c },
            onClick: () => onEdgeColorChange(selectedEdge.id, c),
          }))
        ),
        React.createElement('button', { className: 'btn-red', onClick: onDeleteEdge }, '✕ Delete Arrow'),
      ),

      // Export / Import
      React.createElement('div', { className: 'sb-section' },
        React.createElement('div', { className: 'sb-label' }, 'Diagram Data'),
        React.createElement('button', { className: 'btn-blue', onClick: onExport }, '⬇ Export JSON'),
        React.createElement('label', { className: 'file-btn' },
          '⬆ Import JSON',
          React.createElement('input', {
            type: 'file', accept: '.json',
            style: { display: 'none' },
            onChange: onImport,
          })
        ),
        React.createElement('button', { className: 'btn-gray', onClick: onClear }, '✕ Clear All'),
      ),

      // Legend
      React.createElement('div', { className: 'sb-section', style: { marginTop: 'auto' } },
        React.createElement('div', { className: 'sb-label' }, 'Legend'),
        React.createElement('div', { className: 'info-box' },
          ...Object.entries(SHAPES).map(([k, v]) =>
            React.createElement('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 } },
              React.createElement('div', { style: { width: 12, height: 12, background: v.bg, borderRadius: k === 'start' ? '50%' : k === 'decision' ? 0 : 3, transform: k === 'decision' ? 'rotate(45deg)' : 'none', flexShrink: 0 } }),
              React.createElement('span', null, v.label),
            )
          )
        ),
      ),
    );
  }

  // ── Main App (needs ReactFlowProvider context) ──────────────────────────────
  function FlowApp() {
    const [nodes, setNodes, onNodesChange] = useNodesState(DEFAULT_NODES);
    const [edges, setEdges, onEdgesChange] = useEdgesState(DEFAULT_EDGES);
    const [activeColor, setActiveColor] = useState('#10b981');
    const [selectedNode, setSelectedNode] = useState(null);
    const [selectedEdge, setSelectedEdge] = useState(null);
    const reactFlowWrapper = useRef(null);
    const { screenToFlowPosition } = useReactFlow();

    // Keep selectedNode/Edge in sync with actual node/edge data
    useEffect(() => {
      if (selectedNode) {
        const n = nodes.find(n => n.id === selectedNode.id);
        if (n) setSelectedNode(n);
      }
    }, [nodes]);

    useEffect(() => {
      if (selectedEdge) {
        const e = edges.find(e => e.id === selectedEdge.id);
        if (e) setSelectedEdge(e);
      }
    }, [edges]);

    // Connect nodes
    const onConnect = useCallback(params => {
      const edge = {
        ...params,
        type: 'smoothstep',
        style: { stroke: activeColor, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: activeColor },
      };
      setEdges(eds => addEdge(edge, eds));
    }, [activeColor, setEdges]);

    // Drop from palette
    const onDrop = useCallback(e => {
      e.preventDefault();
      const shape = e.dataTransfer.getData('shape');
      const label = e.dataTransfer.getData('label');
      if (!shape) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setNodes(ns => [...ns, {
        id: nextId(),
        type: 'process',
        position,
        data: { label, shape },
      }]);
    }, [screenToFlowPosition, setNodes]);

    const onDragOver = useCallback(e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }, []);

    // Selection
    const onNodeClick = useCallback((_, node) => {
      setSelectedNode(node);
      setSelectedEdge(null);
    }, []);

    const onEdgeClick = useCallback((_, edge) => {
      setSelectedEdge(edge);
      setSelectedNode(null);
    }, []);

    const onPaneClick = useCallback(() => {
      setSelectedNode(null);
      setSelectedEdge(null);
    }, []);

    // Add node from sidebar form
    const handleAddNode = useCallback((shape, label) => {
      const lbl = label.trim() || SHAPES[shape]?.label || 'Step';
      setNodes(ns => [...ns, {
        id: nextId(),
        type: 'process',
        position: { x: 100 + Math.random() * 400, y: 80 + Math.random() * 280 },
        data: { label: lbl, shape },
      }]);
    }, [setNodes]);

    // Edit node label
    const handleNodeLabelChange = useCallback((id, label) => {
      if (!label.trim()) return;
      setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, label: label.trim() } } : n));
    }, [setNodes]);

    // Delete node
    const handleDeleteNode = useCallback(() => {
      if (!selectedNode) return;
      setNodes(ns => ns.filter(n => n.id !== selectedNode.id));
      setEdges(es => es.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
      setSelectedNode(null);
    }, [selectedNode, setNodes, setEdges]);

    // Edit edge label
    const handleEdgeLabelChange = useCallback((id, label) => {
      setEdges(es => es.map(e => e.id === id ? { ...e, label } : e));
    }, [setEdges]);

    // Recolor edge
    const handleEdgeColorChange = useCallback((id, color) => {
      setEdges(es => es.map(e => e.id === id
        ? { ...e, style: { ...e.style, stroke: color }, markerEnd: { type: MarkerType.ArrowClosed, color } }
        : e
      ));
      setSelectedEdge(se => se && se.id === id
        ? { ...se, style: { ...se.style, stroke: color }, markerEnd: { type: MarkerType.ArrowClosed, color } }
        : se
      );
    }, [setEdges]);

    // Delete edge
    const handleDeleteEdge = useCallback(() => {
      if (!selectedEdge) return;
      setEdges(es => es.filter(e => e.id !== selectedEdge.id));
      setSelectedEdge(null);
    }, [selectedEdge, setEdges]);

    // Export
    const handleExport = useCallback(() => {
      const data = JSON.stringify({ nodes, edges }, null, 2);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'diagram.json';
      a.click();
    }, [nodes, edges]);

    // Import
    const handleImport = useCallback(e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const d = JSON.parse(ev.target.result);
          if (d.nodes) setNodes(d.nodes);
          if (d.edges) setEdges(d.edges);
        } catch { alert('Invalid JSON file.'); }
      };
      reader.readAsText(file);
      e.target.value = '';
    }, [setNodes, setEdges]);

    // Clear
    const handleClear = useCallback(() => {
      if (confirm('Clear all shapes and connections?')) {
        setNodes([]);
        setEdges([]);
        setSelectedNode(null);
        setSelectedEdge(null);
      }
    }, [setNodes, setEdges]);

    return React.createElement('div', { style: { display: 'flex', width: '100vw', height: '100vh' } },

      React.createElement(Sidebar, {
        activeColor, setActiveColor,
        onAddNode: handleAddNode,
        onExport: handleExport,
        onImport: handleImport,
        onClear: handleClear,
        selectedEdge,
        onEdgeLabelChange: handleEdgeLabelChange,
        onEdgeColorChange: handleEdgeColorChange,
        onDeleteEdge: handleDeleteEdge,
        selectedNode,
        onNodeLabelChange: handleNodeLabelChange,
        onDeleteNode: handleDeleteNode,
      }),

      React.createElement('div', {
        id: 'canvas-wrap',
        ref: reactFlowWrapper,
        onDrop,
        onDragOver,
      },
        React.createElement(ReactFlow, {
          nodes,
          edges,
          onNodesChange,
          onEdgesChange,
          onConnect,
          nodeTypes,
          onNodeClick,
          onEdgeClick,
          onPaneClick,
          fitView: true,
          deleteKeyCode: 'Delete',
          defaultEdgeOptions: {
            type: 'smoothstep',
            style: { stroke: activeColor, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: activeColor },
          },
        },
          React.createElement(Controls),
          React.createElement(MiniMap, {
            nodeColor: n => SHAPES[n.data?.shape]?.bg || '#7c3aed',
            maskColor: 'rgba(15,23,42,0.7)',
          }),
          React.createElement(Background, {
            variant: BackgroundVariant.Dots,
            gap: 28,
            size: 1,
            color: '#1e293b',
          }),
        )
      ),
    );
  }

  // ── Root ────────────────────────────────────────────────────────────────────
  function App() {
    return React.createElement(ReactFlowProvider, null,
      React.createElement(FlowApp, null)
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    React.createElement(App, null)
  );

})();
