import bcrypt from "bcryptjs";
import neo4j, { Driver, Session } from "neo4j-driver";
import "react-native-get-random-values";
import { v4 as uuidv4 } from "uuid";
import {
  EdgeData,
  Neo4jId,
  neo4jLoginInfo,
  PersonNodeData,
  PersonNodeMap,
  Properties,
} from "./dataType";
// import {
//   encryptWithAes,
//   decryptWithAes,
//   generateKey,
//   base64ToArrayBuffer,
// } from "./crypto-utils";

// const MASTER_KEY = Buffer.from(
//   "GHBeEc7OAH1odOm9K/A1AeezETWzaM+n/3CgxGMHk3E=",
//   "base64"
// );
// const MASTER_KEY = Buffer.from(
//   base64ToArrayBuffer("GHBeEc7OAH1odOm9K/A1AeezETWzaM+n/3CgxGMHk3E=")
// );

interface DisconnectedInfo {
  status: "disconnected";
  neo4jInfo: neo4jLoginInfo;
}

interface ConnectedInfo {
  status: "connected";
  neo4jInfo: neo4jLoginInfo;
  driver: Driver;
  session: Session;
}

interface LoggedInInfo {
  status: "logged in";
  neo4jInfo: neo4jLoginInfo;
  driver: Driver;
  session: Session;
  userId: string;
}

const NEO4JINFO: neo4jLoginInfo = {
  url: "neo4j+s://88964078.databases.neo4j.io",
  username: "neo4j",
  password: "dwYzcQjWVcdltn3CuFjXOOlexAqucW51BTEHCmm7llg",
};

const defaultInfo: DisconnectedInfo = {
  status: "disconnected",
  neo4jInfo: NEO4JINFO,
};

interface UserInfo {
  name: string;
  pwd: string;
  clusterN: number;
  nodeN: number;
}

export type UserID = string;

type EventType =
  | "connected to neo4j"
  | "changed username"
  | "logged in"
  | "logged out";

interface EventParamMap {
  "connected to neo4j": { timestamp: Date };
  "changed username": { name: string };
  "logged in": { userId: string; timestamp: Date };
  "logged out": { userId: string };
}

export class Neo4jConnector {
  info: DisconnectedInfo | ConnectedInfo | LoggedInInfo = defaultInfo;

  private listeners: {
    [K in EventType]?: ((ev: EventParamMap[K]) => void)[];
  } = {};

  constructor() {
    // this.connectToNeo4j();
  }

  addEventListener<K extends EventType>(
    eventType: K,
    listener: (ev: EventParamMap[K]) => void
  ) {
    if (!this.listeners[eventType]) {
      this.listeners[eventType] = [];
    }
    this.listeners[eventType]!.push(listener);
  }

  // Trigger event (for internal use)
  private dispatchEvent<K extends EventType>(
    eventType: K,
    param: EventParamMap[K]
  ) {
    this.listeners[eventType]?.forEach((listener) => listener(param));
  }

  async connectToNeo4j(): Promise<void> {
    if (this.info.status != "disconnected") {
      console.log("connectToNeo4j: already connected");
      return;
    }
    const driver = neo4j.driver(
      this.info.neo4jInfo.url,
      neo4j.auth.basic(
        this.info.neo4jInfo.username,
        this.info.neo4jInfo.password
      ),
      { disableLosslessIntegers: true }
    );
    console.log("[connectToNeo4j] waiting for connection...");
    var ServerInfo = await driver.getServerInfo();
    console.log("[connectToNeo4j] connected!");
    this.info = {
      status: "connected",
      neo4jInfo: this.info.neo4jInfo,
      driver: driver,
      session: driver.session(),
    } as ConnectedInfo;
    this.dispatchEvent("connected to neo4j", { timestamp: new Date() });
  }

  private async query(cypher: string, params: any) {
    if (this.info.status == "disconnected") {
      throw new Error("Can not query before connecting to Neo4j");
    } else {
      try {
        var session = this.info.driver.session();
        const res = await session.run(cypher, params, {
          timeout: 1000,
        });
        session.close();
        return res;
      } catch (e) {
        throw e;
      }
    }
  }

  async createUser(username: string, pwd: string): Promise<UserID> {
    const cypher = `
      CREATE (:User {
        userId: $userId,  
        username: $username,
        password_hash: $password_hash
      })`;
    const userId = uuidv4();
    // ref: https://www.npmjs.com/package/bcryptjs
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(pwd, salt);
    await this.query(cypher, {
      userId,
      username,
      password_hash,
    });
    return userId;
  }
  // async getUserInfo(id: UserID): Promise<UserInfo> {
  //   return { name: "", pwd: "", clusterN: 0, nodeN: 0 };
  // }
  async changeUserName(name: string): Promise<void> {
    if (this.info.status != "logged in") {
      throw new Error("Can not change username before logging in");
    }
    const cypher = `
      MATCH (u:User {userId: $userId}) SET u.username = $name
    `;
    await this.query(cypher, {
      userId: this.info.userId,
      name,
    });
    this.dispatchEvent("changed username", { name });
  }
  async changeUserPwd(pwd: string): Promise<void> {
    if (this.info.status != "logged in") {
      throw new Error("Can not change password before logging in");
    }
    const cypher = `
      MATCH (u:User {userId: $userId}) SET u.password_hash = $password_hash
    `;
    // ref: https://www.npmjs.com/package/bcryptjs
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(pwd, salt);
    await this.query(cypher, {
      userId: this.info.userId,
      password_hash,
    });
  }
  async logIn(username: string, pwd: string): Promise<void> {
    if (this.info.status == "disconnected") {
      throw new Error("Can not log in before connecting to Neo4j");
    }
    const cypher = `
      MATCH (u:User {username: $username}) RETURN
        u.userId AS userId,
        u.password_hash AS password_hash`;
    const result = await this.query(cypher, { username });
    if (result.records.length === 0) throw new Error("User not found");
    const record = result.records[0];
    const valid = await bcrypt.compare(pwd, record.get("password_hash"));
    if (!valid) throw new Error("Invalid password");
    this.info = {
      ...this.info,
      status: "logged in",
      userId: record.get("userId"),
    };
    this.dispatchEvent("logged in", {
      userId: record.get("userId"),
      timestamp: new Date(),
    });
  }
  async logOut(): Promise<void> {
    if (this.info.status != "logged in") {
      throw new Error("Can not log out before logging in");
    }
    var userId = this.info.userId;
    this.info = {
      ...this.info,
      status: "connected",
      userId: undefined,
    } as ConnectedInfo;
    this.dispatchEvent("logged out", {
      userId,
    });
  }

  async retrieveInfoAsMap(): Promise<PersonNodeMap> {
    if (this.info.status != "logged in") {
      throw new Error("Can not fetch/update data before logging in");
    }
    const cypher = `
      MATCH (:User {userId: $userId})-[:OWNS]->(p:Person) RETURN p
    `;
    var result = await this.query(cypher, { userId: this.info.userId });
    if (result === undefined) {
      console.log("ERR: res is undefined");
      return {};
    } else {
      var people: PersonNodeData[] = result.records.map(
        (record) => record.get("p") as PersonNodeData
      );
      // ref: https://stackoverflow.com/questions/42974735/create-object-from-array
      return people.reduce(
        (acc, cur) => ({ ...acc, [cur.elementId]: cur }),
        {}
      );
    }
  }

  async updateNodeProperties(
    idPropPairs: { id: Neo4jId; newProp: Properties }[]
  ): Promise<void> {
    if (this.info.status != "logged in") {
      throw new Error("Can not fetch/update data before logging in");
    }

    // var i = 0;

    function whereClause(idPropPair: {
      id: Neo4jId;
      newProp: Properties;
    }): string {
      const changeClause = Object.keys(idPropPair.newProp)
        .map((k) => `${k}:"${idPropPair.newProp[k]}"`)
        .join(",");
      const res = `MATCH (:User {userId: $userId})-[:OWNS]->(p:Person) WHERE elementId(p) = "${idPropPair.id}" set p={${changeClause}}`;
      // i++;
      return res;
    }

    var command = idPropPairs.map(whereClause).join(";\n");
    console.log(`UPD: ${command}`);
    var res = await this.query(command, {
      userId: this.info.userId,
    });
  }

  async retrieveEdgeInfo(): Promise<EdgeData[]> {
    if (this.info.status != "logged in") {
      throw new Error("Can not fetch/update data before logging in");
    }
    const command = `
    MATCH (:User {userId: $userId})-[:OWNS]->(u:Person)-[r1]->(ev)<-[r2]-(v:Person) RETURN u,r1,ev,r2,v`;
    console.log("retrieving Edge Info");
    var res = await this.query(command, {
      userId: this.info.userId,
    });
    console.log(res);
    if (res === undefined) {
      console.log("ERR: res is undefined");
      return [];
    } else {
      interface EdgeDataToBeCombined {
        source: string;
        target: string;
        bidirectional: boolean;
        weight: number;
        description: string;
      }

      var edges_tmp: EdgeDataToBeCombined[] = res.records.map((record) => {
        var u = record.get("u") as PersonNodeData;
        var v = record.get("v") as PersonNodeData;
        return {
          source: u.elementId,
          target: v.elementId,
          bidirectional: true,
          weight: record.get("ev").properties.weight,
          description: record.get("ev").properties.description,
        };
      });

      console.log("got edges tmp");
      console.log(edges_tmp);
      var edges: EdgeData[] = [];
      edges_tmp.forEach((edge) => {
        var index = edges.findIndex(
          (e) => e.source == edge.source && e.target == edge.target
        );
        var index2 = edges.findIndex(
          (e) => e.source == edge.target && e.target == edge.source
        );
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
      });
      return edges;
    }
  }
}

export default new Neo4jConnector();
