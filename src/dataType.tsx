type UUID = string;
type cyID = UUID;
export type Neo4jId = string;

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

export interface EdgeData {
    source: Neo4jId;
    target: Neo4jId;
    bidirectional: boolean;
    weight: number;
    description: string;
}

export interface neo4jLoginInfo {
    url:string;
    username:string;
    password:string;
}