import './cy.css'
import type { NodeDefinition, EdgeDefinition, StylesheetJsonBlock, Position } from 'cytoscape';
import cytoscape from 'cytoscape';
import Layers, { LayersPlugin } from 'cytoscape-layers';
import fcose from 'cytoscape-fcose';
import type {FcoseLayoutOptions} from 'cytoscape-fcose';
import { v4 as uuid } from 'uuid';
cytoscape.use(Layers);
cytoscape.use(fcose);

export const _defaultTagColor = "#000000";
export const _defaultTagTextColor = "#FFFFFF";

const _originalCyStyle: cytoscape.StylesheetJsonBlock[] = [{
    selector: 'node',
    css: {
        'shape': 'rectangle',
        'content': 'data(id)',
        'text-valign': 'center',
        'text-halign': 'center'
    }
},
{
    selector: ':parent',
    css: {
        'text-valign': 'top',
        'text-halign': 'center',
        'shape': 'round-rectangle',
        'corner-radius': "10",
        'padding': "10"
    }
},
{
    selector: 'node#e',
    css: {
        'corner-radius': "10",
        'padding': "10"
    }
},
{
    selector: 'node#d',
    css: {
        'width': '100px',
        'height': '100px'
    }
},
{
    selector: 'edge',
    css: {
        'curve-style': 'bezier',
        'target-arrow-shape': 'triangle'
    }
},
{
    selector: '.hidden',
    css: {
        "opacity": 0.0001 // 奇技淫巧，为0时会消失
    }
},
{
    selector: '.circle',
    css: {
        "shape": "ellipse",
    }
},
{
    selector: '.bidirectional',
    css: {
        'line-color': '#ccc',
        'target-arrow-color': '#ccc',
        'source-arrow-color': '#ccc',
        'target-arrow-shape': 'none',
        'source-arrow-shape': 'none',
        "source-endpoint": "inside-to-node",
        "target-endpoint": "inside-to-node",
    }
}];

const _originalNodes: NodeDefinition[] = [
    { data: { id: 'a', parent: 'b' }, position: { x: 215, y: 85 }, grabbable: false, selectable: false },
    { data: { id: 'b' } },
    { data: { id: 'c', parent: 'b' }, position: { x: 300, y: 85 }, grabbable: false, selectable: false },
    { data: { id: 'd' }, position: { x: 215, y: 175 }, classes: 'hidden circle' },
    { data: { id: 'f' }, position: { x: 450, y: 230 }, classes: 'hidden' }
];

const _originalEdges: EdgeDefinition[] = [
    { data: { id: 'ad', source: 'a', target: 'd' } },
    { data: { id: 'eb', source: 'f', target: 'b' } }];

// function expandedNodeStyle(): StylesheetJsonBlock[] {
//     return [{
//         selector: '.enode-container',
//         css: {
//             'text-valign': 'top',
//             'text-halign': 'center',
//             'content': 'data(enodeId)',
//             'shape': 'round-rectangle',
//             'corner-radius': "10",
//             'padding': "10"
//         }
//     }, {
//         selector: '.enode-avatar',
//         css: {
//             'text-valign': 'center',
//             'text-halign': 'center',
//             'shape': 'ellipse',
//         }
//     }, {
//         selector: '.enode-namefield',
//         css: {
//             'text-valign': 'center',
//             'text-halign': 'center',
//             'shape': 'rectangle',
//             'content': 'data(name)',
//         }
//     }, {
//         selector: '.enode-tag',
//         css: {
//             'text-valign': 'center',
//             'text-halign': 'center',
//             'shape': 'round-tag',
//             'content': 'data(tag)',
//         }
//     }, {
//         selector: '.enode-footnote-l',
//         css: {
//             'text-valign': 'center',
//             'text-halign': 'left',
//             'shape': 'rectangle',
//             'content': 'data(content)',
//         }
//     }, {
//         selector: '.enode-footnote-r',
//         css: {
//             'text-valign': 'center',
//             'text-halign': 'right',
//             'shape': 'rectangle',
//             'content': 'data(content)',
//         }
//     },];
// }

// function expandedNode(d: expandedNodeData): NodeDefinition[] {
//     var nodeIdPrefix = `enode-${d.id}`;
//     function pos(dx: number, dy: number): Position {
//         return { x: d.pos.x + dx, y: d.pos.y + dy };
//     }
//     var parentEleId: string = `${nodeIdPrefix}-parent`;
//     var parentEle: NodeDefinition = {
//         data: { id: parentEleId, enodeId: d.id },
//         classes: 'enode-container',
//     };
//     var avatarEleId: string = `${nodeIdPrefix}-avatar`;
//     var avatarEle: NodeDefinition = {
//         data: { id: avatarEleId, parent: parentEleId, avatar: d.avatar },
//         position: pos(0, 0),
//         classes: 'enode-avatar',
//         grabbable: false, selectable: false
//     };
//     var nameFieldEleId: string = `${nodeIdPrefix}-namefield`;
//     var nameFieldEle: NodeDefinition = {
//         data: { id: nameFieldEleId, parent: parentEleId, name: d.name },
//         position: pos(100, 0),
//         classes: 'enode-namefield',
//         grabbable: false, selectable: false
//     };

//     const _tagsPerRow: number = 4;
//     const _tagUnitWidth: number = 25;
//     const _tagUnitHeight: number = 40;

//     var tagEles: NodeDefinition[] = d.tags.map((tagData, index) => {
//         var tagEleId: string = `${nodeIdPrefix}-tag-${tagData.id}`;
//         var tagEle: NodeDefinition = {
//             data: { id: tagEleId, parent: parentEleId, tag: tagData.tag },
//             classes: 'enode-tag',
//             position: pos((index % _tagsPerRow) * _tagUnitWidth, 50 + Math.floor(index / _tagsPerRow) * _tagUnitHeight),
//             grabbable: false, selectable: false
//         };
//         return tagEle;
//     });


//     var lFootnoteEleId: string = `${nodeIdPrefix}-footnote-l`;
//     // var footnotePosY:number=0;
//     var footnotePosY: number = 50 + (Math.floor(d.tags.length / _tagsPerRow) + 1) * _tagUnitHeight;
//     var lFootnoteEle: NodeDefinition = {
//         data: { id: lFootnoteEleId, parent: parentEleId, content: d.lFootnote },
//         position: pos(0, footnotePosY),
//         classes: 'enode-footnote-l',
//         grabbable: false, selectable: false
//     };
//     var rFootnoteEleId: string = `${nodeIdPrefix}-footnote-r`;
//     var rFootnoteEle: NodeDefinition = {
//         data: { id: rFootnoteEleId, parent: parentEleId, content: d.rFootnote },
//         position: pos(100, footnotePosY),
//         classes: 'enode-footnote-r',
//         grabbable: false, selectable: false
//     };
//     return [parentEle, avatarEle, nameFieldEle, lFootnoteEle, rFootnoteEle].concat(tagEles);
// }

// var testExpandedNodeData: expandedNodeData = {
//     id: 'test',
//     pos: { x: 300, y: 300 },
//     name: 'CHEN SHIMIN',
//     tags: [
//         { id: 'tag1', tag: 'M' },
//         { id: 'tag2', tag: 'NUS' },
//         { id: 'tag3', tag: 'EE' },
//         { id: 'tag4', tag: 'Y1' },
//         { id: 'tag5', tag: 'INTJ' },
//         { id: 'tag6', tag: 'CHN' },
//     ],
//     lFootnote: "14@260",
//     rFootnote: "last update: 2d",
// }

type UUID = string;
type cyID = UUID;
type Neo4jId = string;

interface CyMap {
    [index: cyID]: nodeInfoInCy;
}

interface Neo4jMap {
    [index: Neo4jId]: nodeInfoInCy;
}

interface nodeInfoInCy {
    cyId: cyID;
    neo4jId: Neo4jId;
    domID: string;
    nodeType: "expanded" | "normal";
    data: expandedNodeData | normalNodeData;
}

export interface jotmindFrontend {
    cy: cytoscape.Core;
    layers: LayersPlugin;
    layout: cytoscape.Layouts;
    cyMap: CyMap;
    neo4jMap: Neo4jMap;
}

export function initalizeCy(): jotmindFrontend {
    var cy = cytoscape({
        container: document.getElementById('cy'),

        boxSelectionEnabled: false,

        zoom: 1,

        // style: _originalCyStyle.concat(expandedNodeStyle()),
        style: _originalCyStyle,

        elements: {
            // nodes: _originalNodes.concat(expandedNode(testExpandedNodeData)),
            // nodes: _originalNodes,
            // edges: _originalEdges
            nodes: [],
            edges: []
        },

        layout: {
            name: 'preset',
            padding: 5,
            fit: false,
        }
    });
    const layers: LayersPlugin = (cy as any).layers();

    // layers.renderPerNode(layers.append('html'), (elem, node) => {
    //     // elem.textContent = node.id();
    //     if (node.id() == 'f') {
    //         elem.innerHTML = `
    // <div class="profile-card">
    //   <div class="profile-header">
    //     <img src="/assets/avatar.jpg" alt="Avatar" class="avatar">
    //     <div class="name">CHEN SHIMIN</div>
    //   </div>
    //   <div class="tags">
    //     <span class="tag blue">M</span>
    //     <span class="tag orange">NUS</span>
    //     <span class="tag brown">EE</span>
    //     <span class="tag green">Y1</span>
    //     <span class="tag orange">Birthday: 11/22</span>
    //     <span class="tag purple">INTJ</span>
    //     <span class="tag red">CHN</span>
    //   </div>
    //   <div class="footer">
    //     <span class="left-note">14@260</span>
    //     <span class="right-note">last update: 2d</span>
    //   </div>
    // </div>`;
    //         node.style({ width: elem.clientWidth, height: elem.clientHeight });
    //     } else if (node.id() == 'd') {
    //         elem.innerHTML = `
    // <div class="circle-node">
    //   <img src="/assets/avatar-hardy.jpg" alt="Avatar" class="avatar-circle">
    //   <div class="name">Hardy</div>
    // </div>`;
    //         node.style({ width: elem.clientWidth, height: elem.clientHeight });
    //     }
    // });

    // cy.$('#f').style({width})

    var cyLayout = cy.layout({ name: 'fcose', padding: 100 } as FcoseLayoutOptions); // ! deprecated
    return { cy: cy, layers: layers, cyMap: {}, neo4jMap: {}, layout: cyLayout };
}

export interface TagData {
    // id?: string
    tag: string;
    color?: string;
    textColor?: string;
}

export interface expandedNodeData {
    id?: string;
    nodeType: "expanded";
    neo4jId: Neo4jId;
    // pos: Position;
    name: string;
    tags: TagData[];
    lFootnote: string;
    rFootnote: string;
    avatar?: string;
}

export interface normalNodeData {
    id?: string;
    nodeType: "normal";
    neo4jId: Neo4jId;
    name: string;
    avatar?: string;
}

export type NodeData = expandedNodeData | normalNodeData;

export function isExpandedNodeData(data: NodeData): data is expandedNodeData {
    return data.nodeType === "expanded";
}

const _defaultAvatar = "/assets/avatar-default.jpg";

export function addExpandedNode(cyobj: jotmindFrontend, data: expandedNodeData): nodeInfoInCy {
    let cy = cyobj.cy;
    let layers = cyobj.layers;
    var cyID = data?.id || uuid();
    cy.add([
        { data: { id: cyID }, position: { x: 450, y: 330 }, classes: 'hidden' }
    ]);
    layers.renderPerNode(layers.append('html'), (elem, node) => {
        if (node.id() == cyID) {
            var tagsHTML = data.tags.map((tagData, _) => {
                var tagColor = tagData.color || _defaultTagColor;
                var textColor = tagData.textColor || _defaultTagTextColor;
                return `<span class="tag" style="background-color:${tagColor}; color:${textColor}">${tagData.tag}</span>`;
            }).join('\n');
            elem.innerHTML = `
                <div class="profile-card" id="node-${cyID}">
                    <div class="profile-header">
                        <img src="${data?.avatar || _defaultAvatar}" alt="Avatar" class="avatar">
                        <div class="name">${data.name}</div>
                    </div>
                    <div class="tags">
                        ${tagsHTML}
                    </div>
                    <div class="footer">
                        <span class="left-note">${data.lFootnote}</span>
                        <span class="right-note">${data.rFootnote}</span>
                    </div>
                </div>`;
            node.style({ width: elem.clientWidth, height: elem.clientHeight });
        }
    });
    var info: nodeInfoInCy = {
        cyId: cyID,
        neo4jId: data.neo4jId,
        domID: `node-${cyID}`,
        nodeType: "expanded",
        data: data
    };
    cyobj.cyMap[cyID] = info;
    cyobj.neo4jMap[data.neo4jId] = info;
    return info;
}

export function addNormalNode(cyobj: jotmindFrontend, data: normalNodeData): nodeInfoInCy {
    let cy = cyobj.cy;
    let layers = cyobj.layers;
    var cyID = data?.id || uuid();
    cy.add([
        { data: { id: cyID }, position: { x: 450, y: 400 }, classes: 'hidden circle' }
    ]);
    layers.renderPerNode(layers.append('html'), (elem, node) => {
        if (node.id() == cyID) {
            elem.innerHTML = `
                <div class="circle-node" id="node-${cyID}">
                    <img src="${data?.avatar || _defaultAvatar}" alt="Avatar" class="avatar-circle">
                    <div class="name">${data.name}</div>
                </div>`;
            node.style({ width: elem.clientWidth, height: elem.clientHeight });
        }
    });
    var info: nodeInfoInCy = {
        cyId: cyID,
        neo4jId: data.neo4jId,
        domID: `node-${cyID}`,
        nodeType: "normal",
        data: data
    };
    cyobj.cyMap[cyID] = info;
    cyobj.neo4jMap[data.neo4jId] = info;
    return info;
}

export function addNodes(cyobj: jotmindFrontend, nodes: NodeData[]): nodeInfoInCy[] {
    var nodeInfoList: nodeInfoInCy[] = [];
    nodes.forEach((data) => {
        if (isExpandedNodeData(data)) {
            var info = addExpandedNode(cyobj, data);
            nodeInfoList.push(info);
        } else {
            var info = addNormalNode(cyobj, data);
            nodeInfoList.push(info);
        }
    });
    // cyobj.layout.run();
    return nodeInfoList;
}

export function addEdges(cyobj: jotmindFrontend, edges: EdgeData[]): void {
    let cy = cyobj.cy;
    edges.forEach((edge) => {
        var sourceCyId = cyobj.neo4jMap[edge.source].cyId;
        var targetCyId = cyobj.neo4jMap[edge.target].cyId;
        cy.add([
            {
                group: 'edges',
                data: {
                    id: `${edge.source}-${edge.target}`,
                    source: sourceCyId,
                    target: targetCyId,
                    weight: edge.weight,
                    description: edge.description
                },
                style: {
                    'width': edge.weight,
                },
                classes: edge.bidirectional ? 'bidirectional' : 'unidirectional'
            }
        ]);
    });
    cyobj.cy.layout({ name: 'fcose',fit:false,idealEdgeLength: edge => 100,padding:0 }as FcoseLayoutOptions).run();
}

export interface EdgeData {
    source: Neo4jId;
    target: Neo4jId;
    bidirectional: boolean;
    weight: number;
    description: string;
}