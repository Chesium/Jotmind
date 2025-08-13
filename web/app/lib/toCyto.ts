import type { Claim, Entity } from '@my-repo/shared-types';
import {
  type EdgeDataDefinition,
  type ElementDefinition,
  type NodeDataDefinition,
} from 'cytoscape';

export const CyStyleSheet = [
  {
    selector: 'node[label]',
    style: {
      label: 'data(label)',
    },
  },

  {
    selector: 'edge[label]',
    style: {
      label: 'data(label)',
      width: 3,
      'edge-text-rotation': 'autorotate',
      "text-background-color": "#fff",
      "text-border-opacity": 1
    },
  },
  {
    selector: 'node',
    style: {
      width: 40,
      height: 40,
      shape: 'ellipse',
    },
  },
  {
    selector: 'edge',
    style: {
      width: 15,
    },
  },
  {
    selector: '.Person',
    style: {
      'background-color': '#F38181',
    },
  },
  {
    selector: '.Event',
    style: {
      'background-color': '#FCE38A',
    },
  },
  {
    selector: '.Concept',
    style: {
      'background-color': '#95E1D3',
    },
  },
  {
    selector: '.Place',
    style: {
      'background-color': '#EAFFD0',
    },
  },
  {
    selector: '.Claim',
    style: {
      'background-color': '#B7C4CF',
    },
  },
];

// const commonStyle = {
//   'font-size': 5,
// };

// const ClaimNodeStyle = {
//   'background-color': '#B7C4CF',
// };

export function toCyto(
  emap: Record<string, Entity>,
  cmap: Record<string, Claim>
  // cofe: Record<string, string[]>
): ElementDefinition[] {
  const enodes: NodeDataDefinition[] = Object.values(emap).map((e) => {
    return { id: e.uuid, label: e.name, classes: `${e.type}` };
  });
  const cnodes: NodeDataDefinition[] = Object.values(cmap)
    .filter((c) => c.args.length > 2)
    .map((c) => {
      return { id: c.uuid, label: c.predicate, classes: `Claim` };
    });
  const eeEdges: EdgeDataDefinition[] = Object.values(cmap)
    .filter((c) => c.args.length === 2)
    .map((c) => {
      const sortedArgs = c.args.sort((a1, a2) => a1.position - a2.position);
      return {
        source: sortedArgs[0].node_uuid,
        target: sortedArgs[1].node_uuid,
        label: c.predicate,
        classes: '',
      };
    });
  const ecEdges: EdgeDataDefinition[] = Object.values(cmap)
    .filter((c) => c.args.length > 2)
    .map((c) =>
      c.args.map((a) => {
        return {
          source: a.node_uuid,
          target: c.uuid!,
          label: `${c.predicate}-${a.role}`,
        };
      })
    )
    .flat();
  return [...enodes, ...cnodes, ...eeEdges, ...ecEdges].map((d) => {
    return {
      data: d,
      classes: d.classes,
      // style: { ...d.style, ...commonStyle },
    };
  });
}
