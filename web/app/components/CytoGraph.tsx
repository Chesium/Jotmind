import Cytoscape, { type ElementDefinition } from 'cytoscape';
import CytoscapeComponent from 'react-cytoscapejs';
import fcose from 'cytoscape-fcose';
import { CyStyleSheet } from '~/lib/toCyto';

const elements = [
  { data: { id: 'one', label: 'Node 1' } },
  { data: { id: 'two', label: 'Node 2' } },
  { data: { source: 'one', target: 'two', label: 'Edge from Node1 to Node2' } },
];

export default function CytoGraph({
  elements,
  onClick,
}: {
  elements: ElementDefinition[];
  onClick: (uuid: string) => void;
}) {
  Cytoscape.use(fcose as any);
  const layout = { name: 'fcose', idealEdgeLength: () => 300 };
  return (
    <CytoscapeComponent
      cy={(cy) => {
        cy.on('tap', 'node', function (evt) {
          const node = evt.target;
          console.log('tapped ' + node.id());
          onClick(node.id());
        });
      }}
      stylesheet={CyStyleSheet}
      elements={elements as any}
      pan={{ x: 120, y: 350 }}
      style={{ width: '1000px', height: '1000px' }}
      layout={layout}
    />
  );
}
