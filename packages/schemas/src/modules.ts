import { z } from 'zod';
import { propertySchemaSchema, type PropertySchema } from './graph.js';
import { predicateSpecSchema, type PredicateSpec } from './schema-defs.js';

// ---------------------------------------------------------------------------
// Built-in domain Modules (US-029 / US-030)
//
// A Module is an installable bundle of default *content* for a Knowledge Base:
// custom entity-type schemas (US-027), claim-predicate schemas (US-027), and
// references to built-in inference rule packs (US-022). Installing a Module
// creates those schema definitions inside the KB and installs the referenced
// rule packs — so a user gets a useful, domain-shaped graph without authoring
// schemas/rules from scratch.
//
// The catalog is read-only static content shared by the API (install) and the
// web UI (browse/install). Installing is idempotent: schema definitions already
// present (by conceptual name) are skipped, and rule packs reuse the US-022
// idempotent installer.
// ---------------------------------------------------------------------------

/** A default entity-type schema shipped by a Module (US-027 entity_type). */
export const builtinModuleEntityTypeSchema = z.object({
  /** Stable conceptual type name, e.g. `Person`. */
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  propertySchema: propertySchemaSchema,
});
export type BuiltinModuleEntityType = z.infer<typeof builtinModuleEntityTypeSchema>;

/** A default claim-predicate schema shipped by a Module (US-027 claim_predicate). */
export const builtinModuleClaimPredicateSchema = z.object({
  /** Stable conceptual predicate name, e.g. `attended`. */
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  spec: predicateSpecSchema,
});
export type BuiltinModuleClaimPredicate = z.infer<typeof builtinModuleClaimPredicateSchema>;

/** A reference from a Module to a built-in rule pack (US-022). */
export const builtinModuleRulePackRefSchema = z.object({
  moduleId: z.string().min(1),
  packId: z.string().min(1),
});
export type BuiltinModuleRulePackRef = z.infer<typeof builtinModuleRulePackRefSchema>;

/** A built-in domain Module bundle. */
export const builtinModuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  entityTypes: z.array(builtinModuleEntityTypeSchema),
  claimPredicates: z.array(builtinModuleClaimPredicateSchema),
  rulePacks: z.array(builtinModuleRulePackRefSchema),
});
export type BuiltinModule = z.infer<typeof builtinModuleSchema>;

export const builtinModuleListSchema = z.array(builtinModuleSchema);

// Reusable property schemas -------------------------------------------------

const personProperties: PropertySchema = {
  // Birthday with explicit uncertainty: store the date plus how precise it is
  // (e.g. exact / year-only / approximate) so partial birthdays don't lie.
  birthday: { type: 'string', description: 'Birthday (any precision, e.g. 1990 or 1990-05-01)' },
  birthdayPrecision: {
    type: 'string',
    description: 'How precise the birthday is: exact, month, year, decade, or unknown',
  },
  email: { type: 'string', description: 'Primary email address' },
  phone: { type: 'string', description: 'Primary phone number' },
  social: { type: 'string', description: 'Social handle(s) or profile link(s)' },
  homepage: { type: 'string', description: 'Personal website or homepage' },
  relationshipStrength: {
    type: 'number',
    description: 'Subjective closeness, 0 (acquaintance) to 5 (closest)',
  },
};

const eventProperties: PropertySchema = {
  date: { type: 'date', description: 'When the event happened' },
  location: { type: 'string', description: 'Where the event happened (free text)' },
  kind: { type: 'string', description: 'Kind of event, e.g. meeting, party, conference' },
};

const placeProperties: PropertySchema = {
  locality: { type: 'string', description: 'City or locality, e.g. Shanghai' },
  region: { type: 'string', description: 'State, province, or region' },
  country: { type: 'string', description: 'Country' },
};

const personRole = (name: string, required = false): PredicateSpec['argumentRoles'][number] => ({
  name,
  required,
  entityTypes: ['Person'],
});

// Reading / character-map property schemas ----------------------------------

const characterProperties: PropertySchema = {
  // First appearance (AC2): where/when the character is first introduced — a
  // free-text reference (chapter, scene, page, or work) since works/chapters are
  // typically captured as Notes/Sources rather than entities.
  firstAppearance: {
    type: 'string',
    description: 'Where the character first appears, e.g. "Ch. 1" or "The Fellowship of the Ring"',
  },
  // Attributes (AC2): common character attributes. Names/aliases/tags/notes are
  // first-class entity fields, so none of these are required.
  role: { type: 'string', description: 'Narrative role, e.g. protagonist, antagonist, supporting' },
  species: { type: 'string', description: 'Species or kind, e.g. human, elf, android' },
  gender: { type: 'string', description: 'Gender, if relevant' },
  affiliation: { type: 'string', description: 'Faction, house, or group the character belongs to' },
  status: { type: 'string', description: 'Story status, e.g. alive, deceased, unknown' },
};

const plotEventProperties: PropertySchema = {
  date: { type: 'date', description: 'In-story date the plot event happened, if known' },
  // Sequence number (AC4): an explicit ordinal for ordering plot events when no
  // concrete date exists (e.g. chapter/scene order).
  sequence: {
    type: 'number',
    description: 'Plot order number for sequencing events without dates',
  },
  location: { type: 'string', description: 'Where the plot event happens (free text)' },
  chapter: { type: 'string', description: 'Chapter, scene, or section reference' },
};

const conceptProperties: PropertySchema = {
  category: {
    type: 'string',
    description: 'Concept category, e.g. theme, motif, object, organization',
  },
};

const characterRole = (name: string, required = false): PredicateSpec['argumentRoles'][number] => ({
  name,
  required,
  entityTypes: ['Character'],
});

/**
 * The catalog of built-in domain Modules. Each Module bundles default entity
 * types, claim predicates, and rule pack references (US-029/US-030).
 */
export const BUILTIN_MODULES: readonly BuiltinModule[] = [
  {
    id: 'personal-relationship',
    name: 'Personal Relationship',
    description:
      'People, events, and places for remembering social context over time. Records how, where, and when you met or interacted with people, plus location-aware recall.',
    entityTypes: [
      {
        name: 'Person',
        displayName: 'Person',
        description:
          'A person you know. Names, aliases, and tags/groups are first-class entity fields; custom properties add birthday (with uncertainty), contact/social fields, and relationship strength.',
        propertySchema: personProperties,
      },
      {
        name: 'Event',
        displayName: 'Event',
        description: 'Something that happened where people met, were introduced, or interacted.',
        propertySchema: eventProperties,
      },
      {
        name: 'Place',
        displayName: 'Place',
        description: 'A location used for location-aware recall (e.g. who you know in a city).',
        propertySchema: placeProperties,
      },
    ],
    claimPredicates: [
      {
        name: 'attended',
        displayName: 'attended',
        description: 'A person attended an event.',
        spec: {
          argumentRoles: [
            personRole('person', true),
            { name: 'event', required: true, entityTypes: ['Event'] },
          ],
        },
      },
      {
        name: 'met',
        displayName: 'met',
        description: 'Two people met (optionally at an event).',
        spec: {
          argumentRoles: [
            personRole('person', true),
            personRole('counterpart', true),
            { name: 'event', entityTypes: ['Event'] },
          ],
        },
      },
      {
        name: 'introduced',
        displayName: 'introduced',
        description: 'One person introduced another person.',
        spec: {
          argumentRoles: [personRole('introducer', true), personRole('person', true)],
        },
      },
      {
        name: 'interacted_with',
        displayName: 'interacted with',
        description: 'A person interacted with another person.',
        spec: {
          argumentRoles: [personRole('person', true), personRole('counterpart', true)],
        },
      },
      {
        name: 'mentioned',
        displayName: 'mentioned',
        description: 'A person was mentioned (e.g. in a note or conversation).',
        spec: {
          argumentRoles: [personRole('person', true), { name: 'context', allowLiteral: true }],
        },
      },
      {
        name: 'knows',
        displayName: 'knows',
        description: 'A person knows another person.',
        spec: {
          argumentRoles: [personRole('person', true), personRole('counterpart', true)],
        },
      },
      {
        name: 'lives_in',
        displayName: 'lives in',
        description: 'A person lives in a place — powers location-aware recall (AC4).',
        spec: {
          argumentRoles: [
            personRole('person', true),
            { name: 'place', required: true, entityTypes: ['Place'] },
          ],
        },
      },
    ],
    rulePacks: [{ moduleId: 'personal-relationship', packId: 'event-participation' }],
  },
  {
    id: 'reading-character-map',
    name: 'Reading / Character Map',
    description:
      'Track characters, plot events, places, and concepts for a book, series, or screenplay. Records first appearances, attributes, event participation, and character relationships, then infers family relationships. Use the Network view (filter by tag/work) for the character relationship graph and the Timeline view (by date or plot sequence) for plot events. Capture works, chapters, and quotes as Notes/Sources.',
    entityTypes: [
      {
        name: 'Character',
        displayName: 'Character',
        description:
          'A character (or real person) in a work. Names, aliases, and tags are first-class entity fields; custom properties capture first appearance and attributes (role, species, gender, affiliation, status).',
        propertySchema: characterProperties,
      },
      {
        name: 'Event',
        displayName: 'Plot Event',
        description:
          'A plot event or beat. Orders on the Timeline by date or, when undated, by an explicit plot sequence number.',
        propertySchema: plotEventProperties,
      },
      {
        name: 'Place',
        displayName: 'Place',
        description: 'A location or setting where characters live or plot events happen.',
        propertySchema: placeProperties,
      },
      {
        name: 'Concept',
        displayName: 'Concept',
        description:
          'A theme, motif, object, organization, or other abstract idea referenced in the work.',
        propertySchema: conceptProperties,
      },
    ],
    claimPredicates: [
      {
        name: 'parent_of',
        displayName: 'parent of',
        description:
          'A character is the parent of another character — powers family-relationship inference (sibling/grandparent).',
        spec: {
          argumentRoles: [characterRole('parent', true), characterRole('child', true)],
        },
      },
      {
        name: 'appears_in',
        displayName: 'appears in',
        description: 'A character participates in a plot event.',
        spec: {
          argumentRoles: [
            characterRole('character', true),
            { name: 'event', required: true, entityTypes: ['Event'] },
          ],
        },
      },
      {
        name: 'first_appears_in',
        displayName: 'first appears in',
        description:
          'A character first appears in a work, chapter, or scene (free-text or a captured Source).',
        spec: {
          argumentRoles: [
            characterRole('character', true),
            { name: 'context', required: true, allowLiteral: true },
          ],
        },
      },
      {
        name: 'knows',
        displayName: 'knows',
        description: 'A character knows another character.',
        spec: {
          argumentRoles: [characterRole('character', true), characterRole('counterpart', true)],
        },
      },
      {
        name: 'married_to',
        displayName: 'married to',
        description: 'A character is married to another character.',
        spec: {
          argumentRoles: [characterRole('character', true), characterRole('spouse', true)],
        },
      },
      {
        name: 'allied_with',
        displayName: 'allied with',
        description: 'A character is allied with another character.',
        spec: {
          argumentRoles: [characterRole('character', true), characterRole('ally', true)],
        },
      },
      {
        name: 'enemy_of',
        displayName: 'enemy of',
        description: 'A character is an enemy of another character.',
        spec: {
          argumentRoles: [characterRole('character', true), characterRole('enemy', true)],
        },
      },
      {
        name: 'located_at',
        displayName: 'located at',
        description: 'A character lives at or is associated with a place.',
        spec: {
          argumentRoles: [
            characterRole('character', true),
            { name: 'place', required: true, entityTypes: ['Place'] },
          ],
        },
      },
    ],
    rulePacks: [{ moduleId: 'reading-character-map', packId: 'family-relationship' }],
  },
];

/** Look up a built-in Module by id. */
export function findBuiltinModule(moduleId: string): BuiltinModule | undefined {
  return BUILTIN_MODULES.find((m) => m.id === moduleId);
}

/** Request body to install a built-in Module into a Knowledge Base. */
export const installModuleSchema = z.object({
  moduleId: z.string().min(1),
});
export type InstallModuleRequest = z.infer<typeof installModuleSchema>;

/** One installed/skipped item in a Module install result. */
export const moduleInstallItemSchema = z.object({
  kind: z.enum(['entity_type', 'claim_predicate', 'rule_pack']),
  name: z.string(),
  status: z.enum(['installed', 'skipped']),
  reason: z.string().optional(),
});
export type ModuleInstallItem = z.infer<typeof moduleInstallItemSchema>;

/** Result of installing a Module: per-item install/skip outcomes. */
export const installModuleResultSchema = z.object({
  moduleId: z.string(),
  items: z.array(moduleInstallItemSchema),
});
export type InstallModuleResult = z.infer<typeof installModuleResultSchema>;

/** Installed status of a Module's content within a Knowledge Base (for browse). */
export const moduleStatusSchema = builtinModuleSchema.extend({
  /** Conceptual entity-type names already present as schema definitions. */
  installedEntityTypes: z.array(z.string()),
  /** Conceptual claim-predicate names already present as schema definitions. */
  installedClaimPredicates: z.array(z.string()),
  /** Whether every entity type + claim predicate is already installed. */
  fullyInstalled: z.boolean(),
});
export type ModuleStatus = z.infer<typeof moduleStatusSchema>;

export const moduleStatusListSchema = z.array(moduleStatusSchema);
