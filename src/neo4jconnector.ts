import neo4j, { Driver } from 'neo4j-driver'
import { _defaultTagColor, _defaultTagTextColor } from './cytoscapejsTest/cy.js'
import type { expandedNodeData, normalNodeData, NodeData, TagData, EdgeData } from './cytoscapejsTest/cy.js'

export async function connectToNeo4j(url:string,username:string,password:string): Promise<Driver> {
    // const driver = neo4j.driver(
    //     'neo4j+s://1ddf08c9.databases.neo4j.io', // (1)
    //     // 'neo4j://localhost:7687/', // (1)
    //     neo4j.auth.basic('neo4j', 'Wnb-ife2WhLvtK3n2RHNVbMCz9Jvhq3m9wNLQZEFYQY'), // (2)
    //     { disableLosslessIntegers: true } // (3)
    // );
    const driver = neo4j.driver(
        url,
        neo4j.auth.basic(username, password),
        { disableLosslessIntegers: true }
    );

    console.log("waiting for connection...");
    var info = await driver.getServerInfo();
    console.log(info);
    return driver;
}

export async function testQuery(driver: Driver, cypher: string, params: any) {
    // Create a new session
    const session = driver.session()

    try {
        const res = await session.run(cypher, params,
            { timeout: 3000 }
        );
        // const res = await session.run(
        //     `
        // match (u:Person)-[r1]->(ev)<-[r2]-(v:Person)
        // where u.name = $name1 and v.name = $name2
        // return ev.description
        // `, // (1)
        //     { name1: 'CHEN SHIMIN', name2: 'CHEN HONGYU' }, // (2)
        //     { timeout: 3000 } // (3)
        // );
        console.log(res);
        // res.records.map(record => {
        //     console.log(record.get('ev.description'));
        // });
        return res;
    }
    catch {
        // Handle any errors
    }
    finally {
        // Close the session
        await session.close()
    }
}

type MBTI = "INTJ" | "INTP" | "ENTJ" | "ENTP" | "INFJ" | "INFP" | "ENFJ" | "ENFP" |
    "ISTJ" | "ISFJ" | "ESTJ" | "ESFJ" | "ISTP" | "ISFP" | "ESTP" | "ESFP";

interface PersonNodeProperties {
    name: string;
    hometown?: string;
    nationality?: string;
    major?: string;
    gender: "M" | "F";
    school?: string;
    year_of_study?: string;
    alias?: string;
    Birthday?: string;
    mbti?: MBTI;
}

interface GenernalNodeProperties {
    [key: string]: string;
}

interface PersonNodeData {
    identity: number;
    labels: string[];
    properties: PersonNodeProperties;
    elementId: string;
}

interface EntryStat {
    entries: number;
    wordCount: number;
}

type TagToCy = (value: string) => string;

type ColorGen = (value: string) => string;



const MBTI2Color: ColorGen = (mbti: string) => {
    if (mbti.length != 4) {
        return "black";
    }
    switch (mbti.slice(1, 3)) {
        case "NT":
            return "#88619a";
        case "NF":
            return "#33a474";
        default:
    }
    if (mbti[3] == "J") { // SJ
        return "#4298b4";
    } else {  // SP
        return "#e4ae3a";
    }
}

interface TagSignature {
    t2c: TagToCy;
    color?: string | ColorGen;
    textColor?: string | ColorGen;
}

interface TagMap {
    [key: string]: TagSignature;
}

const DIRECT: TagToCy = (value: string) => value;

function WITHKEY(key: string): TagToCy {
    return (value: string) => {
        return `${key}: ${value}`;
    }
}

const entryIndexInProperties: string[] = ["name", "hometown", "nationality", "major",
    "gender", "school", "year_of_study", "alias", "Birthday", "mbti"];

const testTagSignature: TagMap = {
    "hometown": { t2c: DIRECT, color: "green" },
    "nationality": {
        t2c: DIRECT, color: (s) => {
            switch (s) {
                case "CHN":
                    return "red";
                case "HKG":
                    return "blue";
                default:
                    return "black";
            }
        }
    },
    "major": {
        t2c: WITHKEY("maj"), color: (s) => {
            switch (s) {
                case "EE":
                    return "#795548";
                case "BBA":
                    return "orange";
                default:
                    return "black";
            }
        }
    },
    "gender": {
        t2c: DIRECT, color: (s) => {
            switch (s) {
                case "M":
                    return "blue";
                case "F":
                    return "pink";
                default:
                    return "black";
            }
        }
    },
    "school": { t2c: DIRECT, color: "orange" },
    "year_of_study": { t2c: DIRECT, color: "#43A047" },
    "Birthday": { t2c: WITHKEY("birth"), color: "orange" },
    "mbti": { t2c: DIRECT, color: MBTI2Color }
}

function calcEntryStat(data: PersonNodeData, indices: string[] = entryIndexInProperties): EntryStat {
    var entries = 0;
    var wordCount = 0;
    indices.forEach((index) => {
        if ((data.properties as unknown as GenernalNodeProperties)[index] !== undefined) {
            entries++;
            wordCount += (data.properties as unknown as GenernalNodeProperties)[index].split(" ").length;
        }
    });
    return { entries: entries, wordCount: wordCount };
}

function PersonNodeTagToCy(
    prop: GenernalNodeProperties,
    signature: TagMap,
): TagData[] {
    var tags: TagData[] = [];
    for (const key in prop) {
        if (signature[key] !== undefined) {
            var tagSignature = signature[key];
            var tagValue = prop[key];
            var color: string = _defaultTagColor;
            var textColor: string = _defaultTagTextColor;
            if (typeof tagSignature.color === "string") {
                color = tagSignature.color;
            } else if (typeof tagSignature.color === "function") {
                color = tagSignature.color(tagValue);
            }
            if (typeof tagSignature.textColor === "string") {
                textColor = tagSignature.textColor;
            } else if (typeof tagSignature.textColor === "function") {
                textColor = tagSignature.textColor(tagValue);
            }
            var tag: TagData = {
                tag: tagSignature.t2c(tagValue),
                textColor: textColor,
                color: color,
            }
            tags.push(tag);
        }
    }
    return tags;
}

export function PersonNodeDataToCy(
    data: PersonNodeData,
    tagMap: TagMap,
    nodeType: "expanded" | "normal"
): NodeData {
    var entryStat = calcEntryStat(data);
    if (nodeType == "expanded") {
        var expandedNodeData: expandedNodeData = {
            nodeType: "expanded",
            neo4jId: data.elementId,
            name: data.properties.name,
            lFootnote: `${entryStat.entries}@${entryStat.wordCount}`,
            rFootnote: `last update: ...`,
            tags: PersonNodeTagToCy(data.properties as unknown as GenernalNodeProperties, tagMap),
        }
        return expandedNodeData;
    } else {
        var normalNodeData: normalNodeData = {
            nodeType: "normal",
            neo4jId: data.elementId,
            name: data.properties.name,
        }
        return normalNodeData;
    }
}

interface EdgeDataToBeCombined {
    source: string;
    target: string;
    bidirectional: boolean;
    weight: number;
    description: string;
}

export async function retrieveEdgeInfo(driver: Driver): Promise<EdgeData[]> {
    var res = await testQuery(driver, `
        match (u:Person)-[r1]->(ev)<-[r2]-(v:Person)
        return u,r1,ev,r2,v`, {});
    if (res === undefined) {
        console.log("ERR: res is undefined");
        return [];
    } else {
        var edges_tmp: EdgeDataToBeCombined[] = res.records.map(
            (record) => {
                var u = record.get("u") as PersonNodeData;
                var v = record.get("v") as PersonNodeData;
                return {
                    source: u.elementId,
                    target: v.elementId,
                    bidirectional: true,
                    weight: record.get("ev").properties.weight,
                    description: record.get("ev").properties.description,
                }
            }
        );
        var edges: EdgeData[] = [];
        edges_tmp.forEach((edge) => {
            var index = edges.findIndex((e) => e.source == edge.source && e.target == edge.target);
            var index2 = edges.findIndex((e) => e.source == edge.target && e.target == edge.source);
            // consider all edges as bidirectional
            if (index == -1 && index2 == -1) {
                edges.push({
                    source: edge.source,
                    target: edge.target,
                    bidirectional: edge.bidirectional,
                    weight: edge.weight,
                    description: edge.description,
                });
            } else if (index != -1) {
                edges[index].weight += edge.weight;
                edges[index].description += `, ${edge.description}`;
            } else if (index2 != -1) {
                edges[index2].weight += edge.weight;
                edges[index2].description += `, ${edge.description}`;
            }
            
            // if (edge.bidirectional) {
            //     if (index2 != -1) {
            //         edges[index2].weight += edge.weight;
            //         edges[index2].description += `, ${edge.description}`;
            //     }
            // } else {
            //     if (index == -1) {
            //         edges.push({
            //             source: edge.source,
            //             target: edge.target,
            //             bidirectional: edge.bidirectional,
            //             weight: edge.weight,
            //             description: edge.description,
            //         });
            //     } else {
            //         edges[index].weight += edge.weight;
            //         edges[index].description += `, ${edge.description}`;
            //     }
            // }
        });
        return edges;
        // console.log(people);
        // return people.map((p) => PersonNodeDataToCy(p, testTagSignature, "expanded"));  
    }
}

export async function retrieveInfo(driver: Driver): Promise<NodeData[]> {
    const varname = "u";
    var res = await testQuery(driver, `MATCH (${varname}:Person) RETURN ${varname}`, {});
    if (res === undefined) {
        console.log("ERR: res is undefined");
        return [];
    } else {
        var people: PersonNodeData[] = res.records.map(
            (record) => (record.get(varname) as PersonNodeData)
        );
        console.log(people);
        return people.map((p) => PersonNodeDataToCy(p, testTagSignature, "expanded"));
    }
}