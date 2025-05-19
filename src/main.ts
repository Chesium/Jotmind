import './sfpro.css'
import './style.css'
import { initalizeCy,addNodes,addEdges } from './cytoscapejsTest/cy.ts'
import type { jotmindFrontend } from './cytoscapejsTest/cy.ts'
import { connectToNeo4j, testQuery,retrieveInfo,retrieveEdgeInfo } from './neo4jconnector.ts'



declare global {  //设置全局属性
    interface Window {  //window对象属性
        cyobj: jotmindFrontend;   //加入对象
    }
}

var cyobj=initalizeCy();

window.cyobj=cyobj;  //将对象加入window对象中


var driver = await connectToNeo4j();
await testQuery(driver, `
    match (u:Person)-[r1]->(ev)<-[r2]-(v:Person)
    where u.name = $name1 and v.name = $name2
    return ev.description`,
    { name1: 'CHEN SHIMIN', name2: 'CHEN HONGYU' });
var nodelist=await retrieveInfo(driver);
console.log(nodelist);
var edgelist=await retrieveEdgeInfo(driver);
console.log(edgelist);
addNodes(cyobj,nodelist);
addEdges(cyobj,edgelist);
