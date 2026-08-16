import React, { useEffect, useRef } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';

interface GraphViewProps {
  nodes: { id: string | number, label: string, isAccept?: boolean, isStart?: boolean }[];
  edges: { from: string | number, to: string | number, label: string }[];
  onSelectNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeIndex: number) => void;
  onDeselect?: () => void;
}

export const GraphView: React.FC<GraphViewProps> = ({
  nodes,
  edges,
  onSelectNode,
  onSelectEdge,
  onDeselect
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

  useEffect(() => {
    if (!container.current) return;

    // Map properties to vis-network formats
    const nodesMapped = nodes.map(n => ({
      id: n.id,
      label: n.label,
      shape: n.isAccept ? 'doublecircle' : 'circle',
      color: {
        background: n.isStart ? '#3b82f6' : (n.isAccept ? '#10b981' : '#1e293b'),
        border: n.isStart ? '#60a5fa' : (n.isAccept ? '#34d399' : '#475569'),
        highlight: { background: '#8b5cf6', border: '#a78bfa' }
      },
      font: { color: '#f8fafc', face: 'Inter' },
      borderWidth: n.isAccept ? 3 : 2,
      shadow: true
    }));

    const edgesMapped = edges.map((e, i) => ({
      id: `e${i}`,
      from: e.from,
      to: e.to,
      label: e.label,
      arrows: 'to',
      font: { align: 'horizontal', color: '#94a3b8', background: '#0f172a' },
      color: { color: '#64748b', highlight: '#a78bfa' },
      smooth: { enabled: true, type: 'curvedCW', roundness: 0.2 }
    }));

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
  }, [nodes, edges]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, []);

  return <div ref={container} className="vis-container" style={{ width: '100%', height: '100%' }} />;
};
