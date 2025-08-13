import z from "zod"
import { makeCypher } from "./cyphers"

const cypher = `
MERGE (me:Person {uuid:"person-me"})
  ON CREATE SET me.name="Shimin Chen", me.description="Collector of scattered life facts built the KG prototype."
MERGE (john:Person {uuid:"person-john"})
  ON CREATE SET john.name="John Doe", john.description="High school classmate quiet, curious."
MERGE (kate:Person {uuid:"person-kate"})
  ON CREATE SET kate.name="Kate Li", kate.description="High school friend told me many fun facts."
MERGE (alice:Person {uuid:"person-alice"})
  ON CREATE SET alice.name="Alice Tan", alice.description="Friendly connector who introduces people."
MERGE (bob:Person {uuid:"person-bob"})
  ON CREATE SET bob.name="Bob Ong", bob.description="New friend met in 2025."
MERGE (carol:Person {uuid:"person-carol"})
  ON CREATE SET carol.name="Carol Lim", carol.description="Works on robotics research."

MERGE (indo:Place {uuid:"place-indonesia"})
  ON CREATE SET indo.name="Indonesia", indo.description="Southeast Asian country."
MERGE (sg:Place {uuid:"place-singapore"})
  ON CREATE SET sg.name="Singapore", sg.description="Island country NUS located here."
MERGE (nus:Place {uuid:"place-nus"})
  ON CREATE SET nus.name="National University of Singapore (NUS)", nus.description="University in Singapore."
MERGE (berk:Place {uuid:"place-berkeley"})
  ON CREATE SET berk.name="Berkeley", berk.description="A city in California, USA."

MERGE (reunion2024:Event {uuid:"event-reunion-2024"})
  ON CREATE SET reunion2024.name="High-school Reunion 2024",
                reunion2024.description="Summer 2024 reunion with high school friends."
MERGE (ee1111aL1:Event {uuid:"event-ee1111a-lecture1-2025"})
  ON CREATE SET ee1111aL1.name="EE1111A Lecture 1 (2025-08-12)",
                ee1111aL1.description="Introduction lecture attendance & peer review count towards CA."
MERGE (careerFair:Event {uuid:"event-career-fair-2025-01-22"})
  ON CREATE SET careerFair.name="Engineering Atrium Career Fair (2025-01-22)",
                careerFair.description="Met several friends networking over coffee."

MERGE (scallop:Concept {uuid:"concept-scallop-theorem"})
  ON CREATE SET scallop.name="Scallop theorem",
                scallop.description="Low Reynolds number swimmers cannot achieve net motion with reciprocal strokes."
MERGE (robotLearning:Concept {uuid:"concept-robot-learning"})
  ON CREATE SET robotLearning.name="Robot Learning",
                robotLearning.description="Learning-based methods for robot control and perception."
MERGE (prolog:Concept {uuid:"concept-prolog"})
  ON CREATE SET prolog.name="Prolog",
                prolog.description="Logic programming language suited for symbolic reasoning."
MERGE (kg:Concept {uuid:"concept-knowledge-graph"})
  ON CREATE SET kg.name="Knowledge Graphs",
                kg.description="Graphs of entities and facts with semantics."

// ————————————————————————————
// Seed: Claims (with ARG role-edges)
// Fields kept minimal as requested
// ————————————————————————————

// C1: "John was born in Indonesia" (told by Kate at the 2024 reunion)
MERGE (c1:Claim {uuid:"claim-bornin-john-indo"})
  ON CREATE SET
    c1.predicate   = "born_in",
    c1.description = "Kate told me at the 2024 reunion that John was born in Indonesia.",
    c1.created_at  = date("2024-07-06"),
    c1.valid_from  = date("1999-01-01"),
    c1.valid_to    = null,
    c1.confidence  = 0.80,
    c1.value_str   = ""
MERGE (c1)-[:ARG {role:"subject",   position:0}]->(john)
MERGE (c1)-[:ARG {role:"object",    position:1}]->(indo)
MERGE (c1)-[:ARG {role:"stated_by", position:2}]->(kate)
MERGE (c1)-[:ARG {role:"at_event",  position:3}]->(reunion2024)

// C2: "I learned about the Scallop theorem via Kate at the same reunion"
MERGE (c2:Claim {uuid:"claim-learned-scallop"})
  ON CREATE SET
    c2.predicate   = "learned_about",
    c2.description = "At the reunion, via Kate, I learned about the Scallop theorem.",
    c2.created_at  = date("2024-07-06"),
    c2.valid_from  = date("2024-07-06"),
    c2.valid_to    = null,
    c2.confidence  = 0.70,
    c2.value_str   = ""
MERGE (c2)-[:ARG {role:"subject",     position:0}]->(me)
MERGE (c2)-[:ARG {role:"object",      position:1}]->(scallop)
MERGE (c2)-[:ARG {role:"via_person",  position:2}]->(kate)
MERGE (c2)-[:ARG {role:"at_event",    position:3}]->(reunion2024)

// C3: "I attended EE1111A Lecture 1"
MERGE (c3:Claim {uuid:"claim-attended-ee1111a-l1"})
  ON CREATE SET
    c3.predicate   = "attended",
    c3.description = "I attended EE1111A Lecture 1 at NUS.",
    c3.created_at  = date("2025-08-12"),
    c3.valid_from  = date("2025-08-12"),
    c3.valid_to    = date("2025-08-12"),
    c3.confidence  = 0.90,
    c3.value_str   = ""
MERGE (c3)-[:ARG {role:"subject",   position:0}]->(me)
MERGE (c3)-[:ARG {role:"object",    position:1}]->(ee1111aL1)
MERGE (c3)-[:ARG {role:"at_place",  position:2}]->(nus)

// C4: "Alice introduced Bob to Carol at the career fair"
MERGE (c4:Claim {uuid:"claim-introduced-bob-to-carol"})
  ON CREATE SET
    c4.predicate   = "introduced",
    c4.description = "Alice introduced Bob to Carol at the Engineering Atrium Career Fair.",
    c4.created_at  = date("2025-01-22"),
    c4.valid_from  = date("2025-01-22"),
    c4.valid_to    = date("2025-01-22"),
    c4.confidence  = 0.60,
    c4.value_str   = ""
MERGE (c4)-[:ARG {role:"introducer", position:0}]->(alice)
MERGE (c4)-[:ARG {role:"introduced", position:1}]->(bob)
MERGE (c4)-[:ARG {role:"to",         position:2}]->(carol)
MERGE (c4)-[:ARG {role:"at_event",   position:3}]->(careerFair)

// C5: "Kate was born in Singapore"
MERGE (c5:Claim {uuid:"claim-bornin-kate-sg"})
  ON CREATE SET
    c5.predicate   = "born_in",
    c5.description = "Birth record says Kate was born in Singapore.",
    c5.created_at  = date("2003-05-01"),
    c5.valid_from  = date("2003-05-01"),
    c5.valid_to    = null,
    c5.confidence  = 0.95,
    c5.value_str   = ""
MERGE (c5)-[:ARG {role:"subject", position:0}]->(kate)
MERGE (c5)-[:ARG {role:"object",  position:1}]->(sg)

// C6: "I study at NUS" (modeled as a simple predicate connecting to Place)
MERGE (c6:Claim {uuid:"claim-studies-at-nus"})
  ON CREATE SET
    c6.predicate   = "studies_at",
    c6.description = "I study at NUS.",
    c6.created_at  = date("2025-01-01"),
    c6.valid_from  = date("2024-08-01"),
    c6.valid_to    = null,
    c6.confidence  = 1.00,
    c6.value_str   = ""
MERGE (c6)-[:ARG {role:"subject", position:0}]->(me)
MERGE (c6)-[:ARG {role:"object",  position:1}]->(nus)

// C7: "Knowledge Graphs help Robot Learning" (concept-to-concept)
MERGE (c7:Claim {uuid:"claim-concept-rel-kg-helps-rl"})
  ON CREATE SET
    c7.predicate   = "helps_with",
    c7.description = "Knowledge Graphs help Robot Learning research.",
    c7.created_at  = date("2025-03-01"),
    c7.valid_from  = date("2025-03-01"),
    c7.valid_to    = null,
    c7.confidence  = 0.75,
    c7.value_str   = ""
MERGE (c7)-[:ARG {role:"subject", position:0}]->(kg)
MERGE (c7)-[:ARG {role:"object",  position:1}]->(robotLearning)

// C8: "Prolog is relevant to Knowledge Graphs" (concept-to-concept)
MERGE (c8:Claim {uuid:"claim-concept-rel-prolog-kg"})
  ON CREATE SET
    c8.predicate   = "related_to",
    c8.description = "Prolog is relevant to Knowledge Graphs and symbolic reasoning.",
    c8.created_at  = date("2025-02-10"),
    c8.valid_from  = date("2025-02-10"),
    c8.valid_to    = null,
    c8.confidence  = 0.65,
    c8.value_str   = ""
MERGE (c8)-[:ARG {role:"subject", position:0}]->(prolog)
MERGE (c8)-[:ARG {role:"object",  position:1}]->(kg)

MERGE (c9:Claim {uuid:"claim-me-mbti"})
  ON CREATE SET
    c9.predicate   = "MBTI",
    c9.description = "My MBTI",
    c9.created_at  = date("2025-02-10"),
    c9.valid_from  = date("2025-02-10"),
    c9.valid_to    = null,
    c9.confidence  = 0.65,
    c9.value_str   = "INTJ"
MERGE (c9)-[:ARG {role:"subject", position:0}]->(me)

MERGE (c9a:Claim {uuid:"claim-me-motto"})
  ON CREATE SET
    c9a.predicate   = "motto",
    c9a.description = "My motto",
    c9a.created_at  = date("2025-02-10"),
    c9a.valid_from  = date("2025-02-10"),
    c9a.valid_to    = null,
    c9a.confidence  = 0.65,
    c9a.value_str   = "per aspera ad astra"
MERGE (c9a)-[:ARG {role:"subject", position:0}]->(me)

MERGE (c10:Claim {uuid:"claim-kate-mbti"})
  ON CREATE SET
    c10.predicate   = "MBTI",
    c10.description = "Kate's MBTI",
    c10.created_at  = date("2025-02-10"),
    c10.valid_from  = date("2025-02-10"),
    c10.valid_to    = null,
    c10.confidence  = 0.65,
    c10.value_str   = "ENFP"
MERGE (c10)-[:ARG {role:"subject", position:0}]->(kate)
`

export const testDataCypher = makeCypher(z.object({}), cypher);