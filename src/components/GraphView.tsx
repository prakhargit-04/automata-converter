import React, { useEffect, useRef } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { getSymbolColor } from '../lib/alphabetColors.ts';

interface GraphViewProps {
  nodes: { id: string | number, label: string, isAccept?: boolean, isStart?: boolean }[];
  edges: { id?: number, from: string | number, to: string | number, label: string }[];
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeIndex: number) => void;
  onDeselect?: () => void;
  /** Node currently "lit up" by the live simulator trace (or a stage preview). */
  activeNodeId?: string | number | null;
  /** Index (matches edges[].id) of the transition just taken by the trace. */
  activeEdgeId?: number | null;
}

export const GraphView: React.FC<GraphViewProps> = ({
  nodes,
  edges,
  onSelectNode,
  onSelectEdge,
  onDeselect,
  activeNodeId = null,
  activeEdgeId = null
}) => {
  const container = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesDataSetRef = useRef<DataSet<any> | null>(null);
  const edgesDataSetRef = useRef<DataSet<any> | null>(null);

  // Latest ref pattern to avoid stale closures in event listeners
  const onSelectNodeRef = useRef(onSelectNode);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const onDeselectRef = useRef(onDeselect);

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
    onSelectEdgeRef.current = onSelectEdge;
    onDeselectRef.current = onDeselect;
  }, [onSelectNode, onSelectEdge, onDeselect]);

  // Build a node's visual style, factoring in whether it's the live-trace's
  // current state. Kept as a function (not baked into nodesMapped) so the
  // active-highlight effect below can restyle a single node without
  // rebuilding/reflowing the whole graph.
  const styleNode = (n: GraphViewProps['nodes'][number]) => {
    const isActive = activeNodeId != null && String(activeNodeId) === String(n.id);
    return {
      id: n.id,
      label: n.label,
      shape: n.isAccept ? 'doublecircle' : 'circle',
      color: {
        background: isActive ? '#facc15' : (n.isStart ? '#3b82f6' : (n.isAccept ? '#10b981' : '#1e293b')),
        border: isActive ? '#fde047' : (n.isStart ? '#60a5fa' : (n.isAccept ? '#34d399' : '#475569')),
        highlight: { background: '#8b5cf6', border: '#a78bfa' }
      },
      font: { color: isActive ? '#0a0c10' : '#f8fafc', face: 'JetBrains Mono, monospace', size: 15 },
      borderWidth: isActive ? 4 : (n.isAccept ? 3 : 2),
      // A soft glow standing in for a "pulse" — vis-network nodes don't
      // support CSS keyframe animation, so the active state gets a strong,
      // unambiguous static treatment instead of a fake-looking flicker.
      shadow: isActive
        ? { enabled: true, color: 'rgba(250, 204, 21, 0.65)', size: 22, x: 0, y: 0 }
        : true
    };
  };

  const styleEdge = (e: GraphViewProps['edges'][number], i: number) => {
    const id = e.id ?? i;
    const isActive = activeEdgeId != null && activeEdgeId === id;
    const symbolColor = getSymbolColor(e.label);
    return {
      id: `e${id}`,
      from: e.from,
      to: e.to,
      label: e.label,
      arrows: 'to',
      font: { align: 'horizontal', color: isActive ? '#facc15' : symbolColor, background: '#0f172a', face: 'JetBrains Mono, monospace' },
      color: { color: isActive ? '#facc15' : symbolColor, highlight: '#a78bfa', opacity: isActive ? 1 : 0.85 },
      width: isActive ? 3.5 : 1.5,
      smooth: { enabled: true, type: 'curvedCW', roundness: 0.2 }
    };
  };

  useEffect(() => {
    if (!container.current) return;

    const nodesMapped = nodes.map(styleNode);
    const edgesMapped = edges.map(styleEdge);

    if (!networkRef.current) {
      // 1. Initial setup: create datasets and network instance
      nodesDataSetRef.current = new DataSet(nodesMapped);
      edgesDataSetRef.current = new DataSet(edgesMapped);

      const data = {
        nodes: nodesDataSetRef.current,
        edges: edgesDataSetRef.current
      };

      const options = {
        physics: {
          barnesHut: {
            gravitationalConstant: -2000,
            centralGravity: 0.3,
            springLength: 95,
            springConstant: 0.04,
            damping: 0.09
          }
        },
        interaction: {
          hover: true,
          tooltipDelay: 200
        }
      };

      networkRef.current = new Network(container.current, data, options);

      // Register vis event listeners (which call latest callbacks in refs)
      networkRef.current.on('selectNode', params => {
        if (onSelectNodeRef.current && params.nodes.length > 0) {
          onSelectNodeRef.current(params.nodes[0].toString());
        }
      });

      networkRef.current.on('selectEdge', params => {
        if (params.nodes.length === 0 && onSelectEdgeRef.current && params.edges.length > 0) {
          const edgeIdStr = params.edges[0].toString();
          const index = edgeIdStr.startsWith('e') ? parseInt(edgeIdStr.substring(1), 10) : parseInt(edgeIdStr, 10);
          if (!isNaN(index)) {
            onSelectEdgeRef.current(index);
          }
        }
      });

      networkRef.current.on('deselectNode', () => {
        if (onDeselectRef.current) onDeselectRef.current();
      });

      networkRef.current.on('deselectEdge', () => {
        if (onDeselectRef.current) onDeselectRef.current();
      });

      // Dotted "blueprint plane" that pans and zooms with the graph instead
      // of sitting static behind it — keeps the canvas feeling alive even
      // once physics settles, without animating anything that would
      // compete with the simulator's active-state glow.
      networkRef.current.on('afterDrawing', () => {
        if (!container.current || !networkRef.current) return;
        const scale = networkRef.current.getScale();
        const pos = networkRef.current.getViewPosition();
        const size = Math.max(10, 28 * scale);
        container.current.style.backgroundSize = `${size}px ${size}px`;
        container.current.style.backgroundPosition =
          `${(-pos.x * scale) % size}px ${(-pos.y * scale) % size}px`;
      });
    } else {
      // 2. Subsequent updates: update existing datasets in-place to prevent layout jumps
      const currentNodes = nodesDataSetRef.current!;
      const currentEdges = edgesDataSetRef.current!;

      // Remove nodes not present in the new nodes list
      const newNodeIds = new Set(nodesMapped.map(n => n.id));
      const oldNodeIds = currentNodes.getIds();
      const nodesToRemove = oldNodeIds.filter(id => !newNodeIds.has(id));
      if (nodesToRemove.length > 0) {
        currentNodes.remove(nodesToRemove);
      }
      currentNodes.update(nodesMapped);

      // Remove edges not present in the new edges list
      const newEdgeIds = new Set(edgesMapped.map(e => e.id));
      const oldEdgeIds = currentEdges.getIds();
      const edgesToRemove = oldEdgeIds.filter(id => !newEdgeIds.has(id.toString()));
      if (edgesToRemove.length > 0) {
        currentEdges.remove(edgesToRemove);
      }
      currentEdges.update(edgesMapped);
    }
  }, [nodes, edges, activeNodeId, activeEdgeId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={container}
      className="vis-container vis-container-grid"
      style={{ width: '100%', height: '100%' }}
    />
  );
};