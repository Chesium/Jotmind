import lunr from "lunr";
import { PersonNodeMap } from "./dataType";

export function initializePersonNodeProps(m: PersonNodeMap): lunr.Index {
    var propList = new Set<string>();
    for (var p of Object.values(m)) {
        // propList += Object.keys(p.properties)
        Object.keys(p.properties).forEach(propList.add, propList);
    }
    var docs = Object.entries(m).map((v) => { return { id: v[0], ...v[1].properties } })
    return lunr(function () {
        this.ref("id");
        this.metadataWhitelist = ['position']
        propList.forEach(k => this.field(k));
        docs.forEach(doc => this.add(doc));
    })
}

export function searchPersonNode(idx: lunr.Index, s: string) {
    var res = idx.search(`${s}~1`);
    console.log("Search RES:");
    console.log(res);
}