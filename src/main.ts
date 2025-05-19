import './sfpro.css'
import './style.css'
import { initalizeCy, addNodes, addEdges } from './cytoscapejsTest/cy.ts'
import type { jotmindFrontend } from './cytoscapejsTest/cy.ts'
import { connectToNeo4j, retrieveInfo, retrieveEdgeInfo } from './neo4jconnector.ts'

const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const inputs = ['link', 'username', 'password'].map(id => document.getElementById(id) as HTMLInputElement);

function resetLoginButton() {
    loginBtn.textContent = 'Log in';
    loginBtn.className = 'login-button';
}

inputs.forEach(input => {
    input.addEventListener('input', resetLoginButton);
});

loginBtn.addEventListener('click', async () => {
    const [link, username, password] = inputs.map(input => input.value);

    loginBtn.textContent = 'Logging in';
    loginBtn.className = 'login-button orange';

    try {
        // await new Promise((res, rej) => setTimeout(() => {
        //     if (link && username && password) res(true);
        //     else rej();
        // }, 3000));

        var driver = await connectToNeo4j(link, username, password);
        // await testQuery(driver, `
        //     match (u:Person)-[r1]->(ev)<-[r2]-(v:Person)
        //     where u.name = $name1 and v.name = $name2
        //     return ev.description`,
        //     { name1: 'CHEN SHIMIN', name2: 'CHEN HONGYU' });
        var nodelist = await retrieveInfo(driver);
        console.log(nodelist);
        var edgelist = await retrieveEdgeInfo(driver);
        console.log(edgelist);
        addNodes(cyobj, nodelist);
        addEdges(cyobj, edgelist);

        loginBtn.textContent = 'Logged in';
        loginBtn.className = 'login-button green';
    } catch {
        loginBtn.textContent = 'Login failed';
        loginBtn.className = 'login-button red';
    }
});

(document.getElementById("link") as HTMLInputElement).value = "neo4j+s://1ddf08c9.databases.neo4j.io";
(document.getElementById("username") as HTMLInputElement).value = "neo4j";
(document.getElementById("password") as HTMLInputElement).value = "Wnb-ife2WhLvtK3n2RHNVbMCz9Jvhq3m9wNLQZEFYQY";

declare global {  //设置全局属性
    interface Window {  //window对象属性
        cyobj: jotmindFrontend;   //加入对象
    }
}

var cyobj = initalizeCy();

window.cyobj = cyobj;  //将对象加入window对象中



